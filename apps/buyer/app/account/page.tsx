import { StubView, AccountIcon } from "@afrimart/ui";

/** Matches AfriMart Buyer App.html's own v-account stub — the real account/seller-profile screen is Prompt 5. */
export default function AccountPage() {
  return <StubView icon={<AccountIcon />} title="Account" description="Addresses, payment and your seller profile, all in one place." />;
}
