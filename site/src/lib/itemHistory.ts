import { isoDateOnly } from './dates';

export interface ItemHistory {
  /** Published content-change timestamps; includes creation. */
  activityDates?: string[];
  created?: string;
  updated: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  createdCommit?: string;
  updatedCommit?: string;
  createdSubject?: string;
  updatedSubject?: string;
}

export const EMPTY_ITEM_HISTORY: ItemHistory = {
  created: '',
  updated: '',
  createdAt: '',
  updatedAt: '',
  createdBy: '',
  updatedBy: '',
  createdCommit: '',
  updatedCommit: '',
  createdSubject: '',
  updatedSubject: '',
};

export function normalizeItemHistory(input: Partial<ItemHistory> | null | undefined): ItemHistory {
  const createdAt = input?.createdAt ?? '';
  const updatedAt = input?.updatedAt ?? '';
  return {
    activityDates: input?.activityDates,
    created: input?.created ?? isoDateOnly(createdAt),
    updated: input?.updated ?? isoDateOnly(updatedAt),
    createdAt,
    updatedAt,
    createdBy: input?.createdBy ?? '',
    updatedBy: input?.updatedBy ?? '',
    createdCommit: input?.createdCommit ?? '',
    updatedCommit: input?.updatedCommit ?? '',
    createdSubject: input?.createdSubject ?? '',
    updatedSubject: input?.updatedSubject ?? '',
  };
}
