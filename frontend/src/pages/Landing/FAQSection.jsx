import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import DiamondSignStop from './DiamondSignStop';

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(null);

  const faqs = [
    {
      q: 'What data formats can I import into RouteWatch?',
      a: 'RouteWatch natively supports CSV, Excel (.xlsx, .xls), GeoJSON, KML, GPX, PDF incident summaries, and compressed ZIP archives. The parser automatically detects coordinate fields, maps column headers, and assigns each row to its local IANA timezone and 2dsphere geometry index.',
    },
    {
      q: 'How large of a file can I upload?',
      a: 'RouteWatch splits large datasets into resumable binary chunks on the client. Files up to multiple gigabytes can be uploaded reliably. If a network interruption occurs, the upload resumes right from the last verified chunk without having to re-read or re-upload from zero.',
    },
    {
      q: 'Who can see what? How do roles work?',
      a: 'RouteWatch features two distinct roles: Citizens can submit live field observations and browse public density maps. Administrators verify incoming reports, resolve hazards, upload bulk datasets, trigger ML re-training, and inspect the tamper-proof audit log.',
    },
    {
      q: 'Is incident data updated in real-time?',
      a: 'Yes. With persistent WebSocket connections powered by Socket.IO, new reports, administrative verifications, hazard resolutions, and dataset ingestion progress stream instantly to connected clients without needing manual browser refreshes.',
    },
    {
      q: 'How do the AI forecasts and severity models work?',
      a: 'Daily incident volume forecasting uses Holt-Winters exponential smoothing to capture 7-day seasonality and cyclical peaks. For severity classification, a scikit-learn Random Forest model evaluates spatial coordinates, hour of day, and incident type to suggest severity ratings.',
    },
  ];

  const toggle = (idx) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section id="faq" className="relative mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <DiamondSignStop
        mood="yellow"
        badge="Stop 06 • Questions"
        title="Frequently asked questions"
        subtitle="Clear details on data compatibility, security boundaries, and geospatial analysis."
      />

      <div className="space-y-4">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          const buttonId = `faq-btn-${idx}`;
          const panelId = `faq-panel-${idx}`;

          return (
            <div
              key={faq.q}
              className="glass overflow-hidden shadow-glass transition-all hover:shadow-lift"
            >
              <button
                type="button"
                id={buttonId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(idx)}
                className="flex w-full items-center justify-between p-5 sm:p-6 text-left font-display text-lg font-bold text-ink focus-visible:outline-sky"
              >
                <span>{faq.q}</span>
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white shadow-clay-white transition-transform duration-200 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                >
                  <ChevronDown className="h-4 w-4 text-ink" />
                </span>
              </button>

              {isOpen && (
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className="px-5 pb-6 sm:px-6 text-sm leading-relaxed text-ink-soft border-t border-slate-200/60 pt-4"
                >
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

