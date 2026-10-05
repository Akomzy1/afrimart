import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Delivery channels, each behind an interface.
 *
 * NTF-2 email, NTF-4 merchant SMS, and merchant web push. None of the three
 * providers are wired yet, and the point of the interfaces is that none of
 * them need to be for the pipeline above to be correct and testable.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development sender: writes each email to disk instead of sending it.
 *
 * Capturing locally rather than posting to a real provider means a test run
 * can never email a real person, which is the failure that gets remembered.
 * Open the files in a browser to check them against the prototypes.
 */
export class FileEmailSender implements EmailSender {
  readonly name = "file";
  private readonly dir: string;
  readonly captured: EmailMessage[] = [];

  constructor(dir = path.resolve(".mail")) {
    this.dir = dir;
  }

  async send(message: EmailMessage): Promise<void> {
    this.captured.push(message);
    await mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = message.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    await writeFile(path.join(this.dir, `${stamp}_${slug}.html`), message.html, "utf8");
  }
}

/** Collects in memory only. For tests that assert on what would have been sent. */
export class MemoryEmailSender implements EmailSender {
  readonly name = "memory";
  readonly captured: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.captured.push(message);
  }
}

export interface PushMessage {
  /** The merchant store this is for. */
  storeId: string;
  title: string;
  body: string;
  url?: string;
}

export interface PushSender {
  readonly name: string;
  send(message: PushMessage): Promise<void>;
}

/**
 * Merchant web push.
 *
 * Real delivery needs VAPID keys and a stored subscription per device. The
 * constraint that shapes the product rather than the code: on iOS, web push
 * only reaches a PWA the user has added to their home screen. A merchant who
 * opens the site in Safari and never installs it will receive nothing — so
 * onboarding has to prompt installation, and that is a Phase 1 requirement
 * for this channel to work at all, not a nicety.
 */
export class MemoryPushSender implements PushSender {
  readonly name = "memory";
  readonly captured: PushMessage[] = [];
  async send(message: PushMessage): Promise<void> {
    this.captured.push(message);
  }
}

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsSender {
  readonly name: string;
  readonly enabled: boolean;
  send(message: SmsMessage): Promise<void>;
}

/**
 * NTF-4 — merchant SMS, switched off until the A2P 10DLC campaign clears.
 *
 * Sending unregistered A2P traffic gets the sending number filtered or
 * blocked by the carriers, so this records what it would have sent and
 * delivers nothing. `enabled` is false until the registration completes;
 * callers check it rather than discovering the silence later.
 */
export class DisabledSmsSender implements SmsSender {
  readonly name = "disabled-pending-10dlc";
  readonly enabled = false;
  readonly suppressed: SmsMessage[] = [];
  async send(message: SmsMessage): Promise<void> {
    this.suppressed.push(message);
  }
}

export interface Senders {
  email: EmailSender;
  push: PushSender;
  sms: SmsSender;
}

let senders: Senders = {
  email: new FileEmailSender(),
  push: new MemoryPushSender(),
  sms: new DisabledSmsSender(),
};

export function getSenders(): Senders {
  return senders;
}

/** Test seam, and the swap point for real providers. */
export function setSenders(next: Partial<Senders>): void {
  senders = { ...senders, ...next };
}
