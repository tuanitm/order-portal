import { query, queryOne } from "@/lib/db/connection";
import { getCompanyId } from "@/lib/config";

export interface CustomerAddress { name: string; address: string | null }

export interface CustomerAddressBook {
  billTo: CustomerAddress[];
  shipTo: CustomerAddress[];
  billToDefault: string | null;
  shipToDefault: string | null;
}

/**
 * A customer's SAP bill-to / ship-to addresses (customer_addresses, refreshed
 * by the SAP Customers sync) — the only addresses a storefront order may use.
 * Customers pick from these and can't type their own; a change goes through
 * admin staff and AR, then SAP.
 */
export async function getCustomerAddressBook(cardCode: string | null): Promise<CustomerAddressBook> {
  if (!cardCode) return { billTo: [], shipTo: [], billToDefault: null, shipToDefault: null };
  const companyId = getCompanyId();
  const [rows, customer] = await Promise.all([
    query<{ address_type: "bill_to" | "ship_to"; address_name: string; full_address: string | null }[]>(
      `SELECT address_type, address_name, full_address FROM customer_addresses
        WHERE company_id = ? AND sap_card_code = ? ORDER BY address_name`,
      [companyId, cardCode]
    ),
    queryOne<{ bill_to_default: string | null; ship_to_default: string | null }>(
      `SELECT bill_to_default, ship_to_default FROM customers WHERE company_id = ? AND sap_card_code = ?`,
      [companyId, cardCode]
    ),
  ]);
  const pick = (type: "bill_to" | "ship_to") =>
    rows.filter((r) => r.address_type === type).map((r) => ({ name: r.address_name, address: r.full_address }));
  return {
    billTo: pick("bill_to"),
    shipTo: pick("ship_to"),
    billToDefault: customer?.bill_to_default ?? null,
    shipToDefault: customer?.ship_to_default ?? null,
  };
}
