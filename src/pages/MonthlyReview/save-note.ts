import { MonthlyWorkbook, Product } from './workbook';
import { Draft, saveDraft } from './storage';
import { productKey } from './batch';

export async function saveProductNote(book: MonthlyWorkbook, draft: Draft, product: Product, note: string, persist = saveDraft) {
  const next = book.clone();
  next.updateProductNote(product, note);
  const data = await next.exportNoteChange(draft.data, product);
  const state = draft.reviewState || { reviewed: [], changed: [] };
  const updated: Draft = { ...draft, data, reviewState: { ...state, changed: [...new Set([...(state.changed || []), productKey(product)])] }, updated: new Date().toISOString(), published: undefined };
  // Publish the in-memory copy only after the transactional revision check succeeds.
  const saved = await persist(updated, draft);
  return { book: next, draft: saved };
}
