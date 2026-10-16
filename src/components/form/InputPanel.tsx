import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Inputs } from '../../engine/types';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { fieldErrors } from '../../model/validate';
import type { Form, Value } from './fields';
import { setAt } from './path';
import {
  ExitSection,
  ExpensesSection,
  FinancingSection,
  IncomeSection,
  MarketSection,
  PurchaseSection,
  TaxSection,
} from './sections';
import type { SectionProps } from './sections';
import { Simulation, mcErrors } from './Simulation';
import type { McSettings } from './Simulation';

interface Props {
  inputs: Inputs;
  mc: McSettings;
  onInputs: (inputs: Inputs) => void;
  onMc: (mc: McSettings) => void;
}

function Section({
  title,
  open,
  children,
}: {
  title: MessageKey;
  open?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <details className="form-section" open={open}>
      <summary>{t(title)}</summary>
      <div className="section-fields">{children}</div>
    </details>
  );
}

export function InputPanel({ inputs, mc, onInputs, onMc }: Props) {
  const t = useT();
  const errors = useMemo(() => fieldErrors(inputs), [inputs]);
  const formRef = useRef<HTMLFormElement>(null);
  // Runs when the set of invalid fields changes, not on every edit, so a section the person closes stays closed.
  const invalid = [...Object.keys(errors), ...Object.keys(mcErrors(mc))].sort().join();
  useEffect(() => {
    for (const field of formRef.current?.querySelectorAll('[aria-invalid="true"]') ?? []) {
      for (let d = field.closest('details'); d; d = d.parentElement?.closest('details') ?? null) {
        d.open = true;
      }
    }
  }, [invalid]);
  const form: Form = {
    values: inputs,
    errors,
    set: (path: string, value: Value) => {
      onInputs(setAt(inputs, path, value));
    },
  };
  const section: SectionProps = { inputs, form, replace: onInputs };
  return (
    <form
      ref={formRef}
      className="input-panel"
      aria-label={t('form.title')}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <Section title="section.market" open>
        <MarketSection {...section} />
      </Section>
      <Section title="section.purchase" open>
        <PurchaseSection {...section} />
      </Section>
      <Section title="section.financing" open>
        <FinancingSection {...section} />
      </Section>
      <Section title="section.income">
        <IncomeSection {...section} />
      </Section>
      <Section title="section.expenses">
        <ExpensesSection {...section} />
      </Section>
      <Section title="section.tax">
        <TaxSection {...section} />
      </Section>
      <Section title="section.exit">
        <ExitSection {...section} />
      </Section>
      <Section title="section.simulation">
        <Simulation mc={mc} onChange={onMc} />
      </Section>
    </form>
  );
}
