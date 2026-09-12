"use client";

import type { ReactNode } from "react";
import { SealIcon, TruckIcon, LockIcon } from "../icons";

export interface StepperProps {
  qty: number;
  onChange: (qty: number) => void;
  label: string;
}

/** Quantity stepper on a cart line (AfriMart Buyer - Cart and Checkout.html). */
export function Stepper({ qty, onChange, label }: StepperProps) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(qty - 1)} aria-label={`Decrease ${label} quantity`}>
        −
      </button>
      <span>{qty}</span>
      <button type="button" onClick={() => onChange(qty + 1)} aria-label={`Increase ${label} quantity`}>
        +
      </button>
    </div>
  );
}

export interface CartLineItemProps {
  name: string;
  altNames: string;
  sellerName: string;
  verified?: boolean;
  unitLabel: string;
  priceLabel: string;
  qty: number;
  image: ReactNode;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
}

/** One line in a parcel: thumb, names, seller, stepper + line price, remove/save. */
export function CartLineItem({
  name, altNames, sellerName, verified, unitLabel, priceLabel, qty, image, onQtyChange, onRemove,
}: CartLineItemProps) {
  return (
    <div className="li">
      <div className="thumb">{image}</div>
      <div className="m">
        <div className="nm">{name}</div>
        <div className="alt">{altNames}</div>
        <div className="seller">
          {sellerName}
          {verified && <SealIcon className="sealmark" />} · {unitLabel}
        </div>
        <div className="foot">
          <Stepper qty={qty} onChange={onQtyChange} label={name} />
          <div className="price tnum">{priceLabel}</div>
        </div>
        <div className="rm">
          <button type="button" onClick={onRemove}>
            Remove
          </button>
          <button type="button">Save for later</button>
        </div>
      </div>
    </div>
  );
}

export interface ParcelGroupProps {
  /** e.g. "Houston" — the origin metro this parcel ships from. */
  originLabel: string;
  arrivesLabel: string;
  /** Shown only when a parcel exists because of a temperature split (CART-3). */
  temperatureLabel?: string;
  children: ReactNode;
}

/** A parcel: its origin/arrival header, then its lines. */
export function ParcelGroup({ originLabel, arrivesLabel, temperatureLabel, children }: ParcelGroupProps) {
  return (
    <div className="parcel">
      <div className="ph">
        <TruckIcon />
        <div className="t">
          Ships from <b>{originLabel}</b> · arrives {arrivesLabel}
          {temperatureLabel ? ` · ${temperatureLabel}` : ""}
        </div>
        <div className="ru" />
      </div>
      <div className="items">{children}</div>
    </div>
  );
}

export interface OrderSummaryProps {
  itemCount: number;
  sellerCount: number;
  parcelCount: number;
  subtotalLabel: string;
  shippingLabel: string;
  totalLabel: string;
  /** Set when the order contains chilled or frozen goods. CART-5. */
  coldPackLabel?: string;
  coldParcelCount?: number;
}

/**
 * CART-5/CART-6 — one subtotal, one total, and at most two cost lines:
 * shipping and cold chain. Two *categories*, never a line per seller or per
 * parcel. Cold chain is separate because it is not shipping and is never
 * absorbed by the free-shipping threshold — and it appears here, in the cart,
 * so it is never a surprise introduced at the payment step.
 */
export function OrderSummary({
  itemCount, sellerCount, parcelCount, subtotalLabel, shippingLabel, totalLabel,
  coldPackLabel, coldParcelCount = 0,
}: OrderSummaryProps) {
  const ambientParcels = Math.max(0, parcelCount - coldParcelCount);
  const parcelWord = ambientParcels === 1 ? "1 parcel" : `${ambientParcels} parcels`;
  const coldWord = coldParcelCount === 1 ? "1 chilled parcel" : `${coldParcelCount} chilled parcels`;
  return (
    <div className="summary">
      <div className="row">
        <span>
          Subtotal{" "}
          <span className="sub">
            {itemCount} items · {sellerCount} {sellerCount === 1 ? "seller" : "sellers"}
          </span>
        </span>
        <span className="v tnum">{subtotalLabel}</span>
      </div>
      {ambientParcels > 0 && (
        <div className="row">
          <span>
            Shipping <span className="sub">{parcelWord} · one blended rate</span>
          </span>
          <span className="v tnum">{shippingLabel}</span>
        </div>
      )}
      {coldPackLabel && (
        <div className="row">
          <span>
            Cold pack <span className="sub">{coldWord} · packed with ice</span>
          </span>
          <span className="v tnum">{coldPackLabel}</span>
        </div>
      )}
      <div className="divider" />
      <div className="total">
        <span className="l">Total</span>
        <span className="v tnum">{totalLabel}</span>
      </div>
      <div className="note">
        <SealIcon />
        <span>
          {coldPackLabel
            ? "One order, one total — never a separate fee per seller. Cold pack keeps the chilled items cold in transit."
            : "One order, one total — never a separate fee per seller."}
        </span>
      </div>
    </div>
  );
}

export interface ActionBarProps {
  /** Small line above the button, e.g. "Total · $84.20". */
  summaryLeft?: ReactNode;
  summaryRight?: ReactNode;
  children: ReactNode;
  trust?: ReactNode;
}

/** The sticky mobile action bar; hidden at desktop, where the rail carries the action. */
export function ActionBar({ summaryLeft, summaryRight, children, trust }: ActionBarProps) {
  return (
    <div className="actionbar on">
      {(summaryLeft || summaryRight) && (
        <div className="sm">
          <span>{summaryLeft}</span>
          <span>{summaryRight}</span>
        </div>
      )}
      {children}
      {trust && (
        <div className="trust">
          <LockIcon />
          {trust}
        </div>
      )}
    </div>
  );
}

export interface BigButtonProps {
  tone?: "green" | "accent";
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}

/** Full-width primary action (Checkout, Pay). */
export function BigButton({ tone = "green", children, onClick, type = "button", disabled }: BigButtonProps) {
  return (
    <button type={type} className={`bigbtn ${tone === "green" ? "green" : "accent"}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export interface CheckoutSectionProps {
  step: number;
  title: string;
  children: ReactNode;
}

/** A numbered checkout step (address, arrival, payment). */
export function CheckoutSection({ step, title, children }: CheckoutSectionProps) {
  return (
    <div className="csec">
      <div className="h">
        <span className="n">{step}</span>
        <h3 className="serif">{title}</h3>
      </div>
      <div className="cbox">{children}</div>
    </div>
  );
}

export interface FormFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  message?: string;
  inputMode?: "text" | "numeric";
  maxLength?: number;
  right?: ReactNode;
}

export function FormField({
  label, value, onChange, placeholder, invalid, message, inputMode, maxLength, right,
}: FormFieldProps) {
  return (
    <div className={`field${invalid ? " invalid" : ""}`}>
      <label>{label}</label>
      <div className={`in${invalid ? " err" : ""}`}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
        />
        {right}
      </div>
      {message && <div className="msg">{message}</div>}
    </div>
  );
}
