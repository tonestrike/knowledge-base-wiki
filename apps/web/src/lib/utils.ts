// Re-export of `cn` under the conventional shadcn path so AI Elements
// components (which expect `@/lib/utils`) resolve without modification.
// New code should keep importing from `@/lib/cn`.
export { cn } from './cn.ts';
