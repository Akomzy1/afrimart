import { StubView, OrdersIcon } from "@afrimart/ui";

/** Matches AfriMart Buyer App.html's own v-orders stub — the real order tracking/history is Prompt 5. */
export default function OrdersPage() {
  return <StubView icon={<OrdersIcon />} title="Your orders" description="Track each parcel and reorder your staples in a tap." />;
}
