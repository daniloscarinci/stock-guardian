/**
 * Domain entity shapes.
 *
 * These are what the application works with. Database rows are snake_case and
 * carry SQL nulls; repositories own the mapping and nothing above them ever
 * sees a raw row.
 */
import type { ExpiryBucket } from '../domain/expiry';
import type { StockStatus } from '../domain/stock';
import type { Language } from '../domain/settings';

export type ItemCondition = 'new' | 'good' | 'fair' | 'poor' | 'unusable';

/** 1 critical, 2 high, 3 normal, 4 low. Lower sorts first. */
export type Priority = 1 | 2 | 3 | 4;

export const PRIORITIES: readonly Priority[] = [1, 2, 3, 4];
export const CONDITIONS: readonly ItemCondition[] = ['new', 'good', 'fair', 'poor', 'unusable'];

export interface LocalizedName {
  readonly lang: Language;
  readonly name: string;
}

export interface InventoryItem {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly locationId: string | null;
  readonly quantity: number;
  readonly unit: string;
  readonly minimumQuantity: number | null;
  readonly idealQuantity: number | null;
  readonly expirationDate: string | null;
  readonly purchaseDate: string | null;
  readonly openedDate: string | null;
  readonly condition: ItemCondition | null;
  readonly priority: Priority;
  readonly notes: string | null;
  readonly barcode: string | null;
  readonly photoId: string | null;
  readonly catalogItemId: string | null;
  readonly archivedAt: string | null;
  /** Anything an import could not map, kept rather than discarded. */
  readonly migrationNotes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An item with its computed status, as the lists and dashboard need it. */
export interface InventoryItemView extends InventoryItem {
  readonly stockStatus: StockStatus;
  readonly expiryBucket: ExpiryBucket;
  readonly daysUntilExpiry: number | null;
  readonly needed: number;
  readonly effectiveMinimum: number;
  readonly categoryName: string | null;
  readonly locationName: string | null;
}

export interface Category {
  readonly id: string;
  readonly icon: string | null;
  readonly color: string | null;
  readonly sortOrder: number;
  readonly isSystem: boolean;
  readonly active: boolean;
  readonly names: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly notes: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A location plus its place in the tree, for hierarchical display. */
export interface LocationNode extends Location {
  readonly depth: number;
  readonly path: readonly string[];
  readonly children: readonly LocationNode[];
  readonly itemCount: number;
}

export interface CatalogItem {
  readonly id: string;
  readonly categoryId: string;
  readonly defaultUnit: string | null;
  readonly sortOrder: number;
  readonly isSystem: boolean;
  readonly names: Readonly<Record<string, string>>;
}

export type StockTransactionType =
  | 'add'
  | 'remove'
  | 'consume'
  | 'transfer'
  | 'correction'
  | 'purchase';

export interface StockTransaction {
  readonly id: string;
  readonly itemId: string;
  readonly type: StockTransactionType;
  readonly quantity: number;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
  readonly sourceLocationId: string | null;
  readonly destinationLocationId: string | null;
  readonly occurredAt: string;
  readonly notes: string | null;
  readonly createdAt: string;
}

export interface Contact {
  readonly id: string;
  readonly name: string;
  readonly relationship: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly location: string | null;
  readonly notes: string | null;
  readonly priority: Priority;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A page of results plus the cursor that continues it. */
export interface Page<T> {
  readonly rows: readonly T[];
  readonly nextCursor: string | null;
  readonly total: number;
}
