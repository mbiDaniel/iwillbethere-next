import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  FileUp,
  UserRoundPen,
  Send,
  Ticket,
  Sparkles,
  Layers,
} from "lucide-react";
import { MarketingLayout } from "@/components/shell";
import { FlyerPreview } from "@/components/flyer";
import { events } from "@/lib/mock-data";
const steps = [
  {
    icon: FileUp,
    title: "Upload your design",
    body: "Start with your Photoshop flyer. Mark the layers your guests can personalize.",
  },
  {
    icon: UserRoundPen,
    title: "Make it personal",
    body: "Guests open your link and add their name and photo. Your design stays intact.",
  },
  {
    icon: Send,
    title: "Share the excitement",
    body: "Everyone gets their own event flyer, ready to download and share.",
  },
];
export default function Home() {
  return (
    <MarketingLayout>
      <main>
        <section className="wrap hero">
          <div className="intro">
            <span className="kicker">
              <Ticket size={14} /> Personalized event flyers
            </span>
            <h1>
              Your event.
              <br />
              Their moment<span>.</span>
            </h1>
            <p>
              Turn one Photoshop design into a personalized event flyer for
              every guest.
            </p>
            <div className="actions">
              <Link className="btn primary" href="/dashboard/events/new">
                Create an event <ArrowRight size={17} />
              </Link>
              <Link className="btn secondary" href="/e/after-hours">
                See an example <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="smallnote">
              <Layers size={14} /> Designed by you. Personalized by guests.
            </div>
          </div>
          <div className="stage">
            <div className="backprint">
              <img src="/open-studio.svg" alt="Open Studio sample print" />
            </div>
            <div className="frontprint">
              <FlyerPreview event={events[0]} sample />
            </div>
            <div className="starsticker" aria-hidden="true">
              <svg viewBox="0 0 100 100">
                <path d="M50 2l7 17 15-11 1 19 19-3-8 17 15 9-17 9 9 17-20-3-1 19-14-11-7 17-7-18-16 11 1-19-20 3 9-17L1 49l18-9-8-17 19 4 1-19 14 12Z" />
                <path className="smile" d="M31 54q19 29 39-2M37 37v7m24-8v7" />
              </svg>
            </div>
            <span className="sample-tag">
              <span /> Sample flyer
            </span>
          </div>
        </section>
        <section className="how" id="how">
          <div className="wrap">
            <div className="section-title">
              <div>
                <span className="section-label">
                  <Sparkles size={14} /> How it works
                </span>
                <h2>From design to guest list.</h2>
              </div>
              <span className="section-aside">Three simple steps</span>
            </div>
            <div className="step-grid">
              {steps.map(({ icon: Icon, title, body }, i) => (
                <article className="step-card" key={title}>
                  <div className="step-top">
                    <span className={`step-icon color${i}`}>
                      <Icon size={23} />
                    </span>
                    <span className="step-num">0{i + 1}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </MarketingLayout>
  );
}
