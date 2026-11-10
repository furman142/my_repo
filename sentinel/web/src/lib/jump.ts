/** One-shot "open this moment" request passed from the Events page to the Recordings page. */
export interface Jump {
  camera: string;
  date: string;
  at: Date;
}
let pending: Jump | null = null;
export const requestJump = (j: Jump) => {
  pending = j;
};
export const takeJump = (): Jump | null => {
  const j = pending;
  pending = null;
  return j;
};
