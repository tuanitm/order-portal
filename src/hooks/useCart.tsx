"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useState,
  ReactNode,
} from "react";

// ── Cart Item Type ──
export interface CartItem {
  sapItemCode: string;
  itemName: string;
  unitPrice: number;
  originalPrice: number;
  quantity: number;
  uom: string;
  imageUrl: string | null;
  discountPercent: number;
  /** Buy-X-get-Y bonus-item promo, if any — the free quantity for this line
   * is recalculated from `quantity` (see calculateFreeQty), not stored. */
  promoBuyQty?: number;
  promoGiveQty?: number;
  promoGiveItemCode?: string;
  promoGiveItemName?: string;
  /** Set only on a line added via Excel Import — the customer's free-text Remark column for that row. */
  remark?: string;
  /** Individual discount-waterfall percentages that compound into discountPercent above — see
   *  ProductWithPricing's own fields of the same name. Carried through to order_lines so Admin -
   *  Order can show which discount type(s) applied, not just the combined discountPercent. */
  periodDiscPct?: number;
  contractDiscPct?: number;
  promoDiscPct?: number;
  /** Which specific promotion program the customer chose (or the auto-default, when the item only ever
   *  had one candidate) — see ProductWithPricing.promotionOptions/giveawayOptions. Persisted on order_lines
   *  so the SAP push uses the SAME program instead of re-deriving a possibly-different "best" match. */
  promotionCode?: string;
  promotionName?: string;
  giveawayCode?: string;
  giveawayName?: string;
  /** Display-only — drives the checkout page's "this will create N orders" brand-split preview.
   *  The actual order split is decided server-side by POST /api/orders' own live items.brand_code lookup. */
  brandCode?: string | null;
  brandName?: string | null;
}

/**
 * Free ("give") quantity a cart line currently earns, recomputed from its
 * live quantity — e.g. "buy 2 get 1" at quantity 5 gives floor(5/2)*1 = 2,
 * and updates immediately as the customer changes quantity in the cart.
 */
export function calculateFreeQty(item: CartItem): number {
  if (!item.promoBuyQty || !item.promoGiveQty) return 0;
  return Math.floor(item.quantity / item.promoBuyQty) * item.promoGiveQty;
}

/**
 * A cart LINE's identity — what makes two adds "the same line" (merge
 * quantity) vs. two separate lines. The vast majority of items have no
 * buy-give choice at all, so they key on sapItemCode alone, same as always.
 * But one selling item can offer a CHOICE of several different free items
 * (same or different promotion programs) — see ProductCard's per-pair
 * cards — and the customer must be able to add that same selling item more
 * than once with a DIFFERENT free item chosen each time, as independent
 * lines rather than merging into one (which could only ever remember one
 * choice). Including giveawayCode in the key too (not just promoGiveItemCode)
 * keeps two DIFFERENT programs that happen to give the same free item apart.
 *
 * Same idea for a plain percent-discount promotionCode with no giveaway: a
 * customer splitting one item's quantity across two different promotion
 * programs (see ImportExcelModal's manual split) needs each program's
 * portion to stay its own line with its own price — merging them would
 * silently keep only the first line's price/program for the combined qty.
 */
export function getCartLineKey(
  item: Pick<CartItem, "sapItemCode" | "giveawayCode" | "promoGiveItemCode" | "promotionCode">
): string {
  if (item.promoGiveItemCode) {
    return `${item.sapItemCode}::${item.giveawayCode ?? ""}::${item.promoGiveItemCode}`;
  }
  if (item.promotionCode) {
    return `${item.sapItemCode}::promo::${item.promotionCode}`;
  }
  return item.sapItemCode;
}

// ── Cart State ──
interface CartState {
  items: CartItem[];
  isOpen: boolean;
}

// ── Cart Actions ──
// REMOVE_ITEM/UPDATE_QUANTITY identify the target line by its getCartLineKey()
// string, not the bare sapItemCode — see that function's own comment on why
// (multiple lines can share a sapItemCode once free-item choices split them).
type CartAction =
  | { type: "ADD_ITEM"; payload: CartItem }
  | { type: "REMOVE_ITEM"; payload: string }
  | { type: "UPDATE_QUANTITY"; payload: { lineKey: string; quantity: number } }
  | { type: "CLEAR_CART" }
  | { type: "TOGGLE_CART" }
  | { type: "OPEN_CART" }
  | { type: "CLOSE_CART" };

// ── Reducer ──
function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      // Silent add — the cart sidebar only opens when the customer clicks
      // the Cart icon (toggleCart/openCart), never as a side effect of
      // adding an item; a small toast (see showToast) is the confirmation.
      const key = getCartLineKey(action.payload);
      const existingIndex = state.items.findIndex(
        (item) => getCartLineKey(item) === key
      );
      if (existingIndex >= 0) {
        const newItems = [...state.items];
        newItems[existingIndex] = {
          ...newItems[existingIndex],
          quantity: newItems[existingIndex].quantity + action.payload.quantity,
        };
        return { ...state, items: newItems };
      }
      return { ...state, items: [...state.items, action.payload] };
    }
    case "REMOVE_ITEM":
      return {
        ...state,
        items: state.items.filter((item) => getCartLineKey(item) !== action.payload),
      };
    case "UPDATE_QUANTITY": {
      if (action.payload.quantity <= 0) {
        return {
          ...state,
          items: state.items.filter(
            (item) => getCartLineKey(item) !== action.payload.lineKey
          ),
        };
      }
      return {
        ...state,
        items: state.items.map((item) =>
          getCartLineKey(item) === action.payload.lineKey
            ? { ...item, quantity: action.payload.quantity }
            : item
        ),
      };
    }
    case "CLEAR_CART":
      return { ...state, items: [] };
    case "TOGGLE_CART":
      return { ...state, isOpen: !state.isOpen };
    case "OPEN_CART":
      return { ...state, isOpen: true };
    case "CLOSE_CART":
      return { ...state, isOpen: false };
    default:
      return state;
  }
}

// ── Context ──
interface CartContextType {
  items: CartItem[];
  isOpen: boolean;
  totalItems: number;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  addItem: (item: CartItem) => void;
  /** Takes a line's getCartLineKey(), not its bare sapItemCode. */
  removeItem: (lineKey: string) => void;
  /** Takes a line's getCartLineKey(), not its bare sapItemCode. */
  updateQuantity: (lineKey: string, quantity: number) => void;
  clearCart: () => void;
  toggleCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  /** Small "Added to cart"-style confirmation — see CartSidebar, which renders it. Auto-dismisses after ~2s. */
  toastMessage: string | null;
  showToast: (message: string) => void;
}

const CartContext = createContext<CartContextType | null>(null);

// ── Provider ──
export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items: [],
    isOpen: false,
  });

  const totalItems = state.items.reduce((sum, item) => sum + item.quantity, 0);

  const subtotal = state.items.reduce(
    (sum, item) => sum + item.originalPrice * item.quantity,
    0
  );

  const grandTotal = state.items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const discountTotal = subtotal - grandTotal;

  const addItem = useCallback(
    (item: CartItem) => dispatch({ type: "ADD_ITEM", payload: item }),
    []
  );
  const removeItem = useCallback(
    (lineKey: string) => dispatch({ type: "REMOVE_ITEM", payload: lineKey }),
    []
  );
  const updateQuantity = useCallback(
    (lineKey: string, quantity: number) =>
      dispatch({ type: "UPDATE_QUANTITY", payload: { lineKey, quantity } }),
    []
  );
  const clearCart = useCallback(() => dispatch({ type: "CLEAR_CART" }), []);
  const toggleCart = useCallback(() => dispatch({ type: "TOGGLE_CART" }), []);
  const openCart = useCallback(() => dispatch({ type: "OPEN_CART" }), []);
  const closeCart = useCallback(() => dispatch({ type: "CLOSE_CART" }), []);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2000);
  }, []);

  return (
    <CartContext.Provider
      value={{
        items: state.items,
        isOpen: state.isOpen,
        totalItems,
        subtotal,
        discountTotal,
        grandTotal,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        toggleCart,
        openCart,
        closeCart,
        toastMessage,
        showToast,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

// ── Hook ──
export function useCart(): CartContextType {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
