const labels: Record<string, string> = { title: 'Title', product: 'Product', horizon: 'Horizon', stage: 'Stage', owner: 'Owner', impact: 'Impact', effort: 'Effort', visibility: 'Visibility', tags: 'Tags', startDate: 'Planned start', endDate: 'Planned end', cover: 'Cover image', coverPosition: 'Cover position', coverFraming: 'Cover framing', body: 'Write-up' };
export const fieldLabel = (field: string) => labels[field] ?? field;
const targets: Record<string, string> = { title: 'item-editor-title-field', startDate: 'item-planned-start', endDate: 'item-planned-end', body: 'section-editor' };
export const fieldTarget = (field: string) => targets[field] ?? `item-editor-${field}`;
export type ReviewItem = { id: string; title: string; changes?: { label: string; before: string; after: string }[] };
export type ChangeSummary = { edited: ReviewItem[]; created: ReviewItem[]; deleted: ReviewItem[]; reorderLanes: number; resources: number };
