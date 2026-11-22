import { env } from "@/lib/env";

export interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html: string;
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<void>;
}

class ConsoleEmailProvider implements EmailProvider {
  async sendEmail(options: SendEmailOptions): Promise<void> {
    console.log("-----------------------------------------");
    console.log("📧 [MOCK EMAIL DISPATCHED]");
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log(`Body:`);
    console.log(options.text || options.html);
    console.log("-----------------------------------------");
  }
}

class ResendEmailProvider implements EmailProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async sendEmail(options: SendEmailOptions): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "I Will Be There <noreply@iwillbethere.com>",
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Resend error:", errorText);
      throw new Error(`Failed to send email via Resend: ${res.statusText}`);
    }
  }
}

export function getEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    return new ResendEmailProvider(env.RESEND_API_KEY);
  }
  return new ConsoleEmailProvider();
}

export const emailProvider = getEmailProvider();
