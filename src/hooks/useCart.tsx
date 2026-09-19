"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
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

// ── Cart State ──
interface CartState {
  items: CartItem[];
  isOpen: boolean;
}

// ── Cart Actions ──
type CartAction =
  | { type: "ADD_ITEM"; payload: CartItem }
  | { type: "REMOVE_ITEM"; payload: string }
  | { type: "UPDATE_QUANTITY"; payload: { sapItemCode: string; quantity: number } }
  | { type: "CLEAR_CART" }
  | { type: "TOGGLE_CART" }
  | { type: "OPEN_CART" }
  | { type: "CLOSE_CART" };

// ── Reducer ──
function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const existingIndex = state.items.findIndex(
        (item) => item.sapItemCode === action.payload.sapItemCode
      );
      if (existingIndex >= 0) {
        const newItems = [...state.items];
        newItems[existingIndex] = {
          ...newItems[existingIndex],
          quantity: newItems[existingIndex].quantity + action.payload.quantity,
        };
        return { ...state, items: newItems, isOpen: true };
      }
      return { ...state, items: [...state.items, action.payload], isOpen: true };
    }
    case "REMOVE_ITEM":
      return {
        ...state,
        items: state.items.filter((item) => item.sapItemCode !== action.payload),
      };
    case "UPDATE_QUANTITY": {
      if (action.payload.quantity <= 0) {
        return {
          ...state,
          items: state.items.filter(
            (item) => item.sapItemCode !== action.payload.sapItemCode
          ),
        };
      }
      return {
        ...state,
        items: state.items.map((item) =>
          item.sapItemCode === action.payload.sapItemCode
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
  removeItem: (sapItemCode: string) => void;
  updateQuantity: (sapItemCode: string, quantity: number) => void;
  clearCart: () => void;
  toggleCart: () => void;
  openCart: () => void;
  closeCart: () => void;
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
    (sapItemCode: string) => dispatch({ type: "REMOVE_ITEM", payload: sapItemCode }),
    []
  );
  const updateQuantity = useCallback(
    (sapItemCode: string, quantity: number) =>
      dispatch({ type: "UPDATE_QUANTITY", payload: { sapItemCode, quantity } }),
    []
  );
  const clearCart = useCallback(() => dispatch({ type: "CLEAR_CART" }), []);
  const toggleCart = useCallback(() => dispatch({ type: "TOGGLE_CART" }), []);
  const openCart = useCallback(() => dispatch({ type: "OPEN_CART" }), []);
  const closeCart = useCallback(() => dispatch({ type: "CLOSE_CART" }), []);

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
