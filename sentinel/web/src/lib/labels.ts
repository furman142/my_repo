export type Label = 'person' | 'vehicle' | 'animal';

export const LABELS: Label[] = ['person', 'vehicle', 'animal'];

export const LABEL_TEXT: Record<Label, string> = { person: 'אדם', vehicle: 'רכב', animal: 'בעל חיים' };
export const LABEL_PLURAL: Record<Label, string> = { person: 'אנשים', vehicle: 'רכבים', animal: 'בעלי חיים' };

/** Same colours as the boxes drawn on event thumbnails. */
export const LABEL_STYLE: Record<Label, { chip: string; dot: string }> = {
  person: { chip: 'border-live/50 bg-live/15 text-red-200', dot: 'bg-live' },
  vehicle: { chip: 'border-signal/50 bg-signal/15 text-blue-200', dot: 'bg-signal' },
  animal: { chip: 'border-ok/50 bg-ok/15 text-green-200', dot: 'bg-ok' },
};

/** Most important kind first: a person outranks a vehicle, which outranks an animal. */
export function topLabel(labels: Partial<Record<Label, number>> | Label[] | undefined): Label | null {
  if (!labels) return null;
  const has = (l: Label) => (Array.isArray(labels) ? labels.includes(l) : labels[l] !== undefined);
  return LABELS.find(has) ?? null;
}
