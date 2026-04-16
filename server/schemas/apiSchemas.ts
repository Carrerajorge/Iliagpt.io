import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export const idParamSchema = z.object({
  id: z.string().uuid({ message: 'Invalid UUID format' }),
});

export type IdParamInput = z.infer<typeof idParamSchema>;

export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export type SortInput = z.infer<typeof sortSchema>;

export const paginationWithSortSchema = paginationSchema.merge(sortSchema);

export type PaginationWithSortInput = z.infer<typeof paginationWithSortSchema>;

export const createUserBodySchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters' }),
  plan: z.enum(['free', 'pro', 'enterprise']).optional().default('free'),
  role: z.enum(['user', 'admin', 'editor', 'viewer', 'api_only']).optional().default('user'),
});

export type CreateUserInput = z.infer<typeof createUserBodySchema>;

export const updateUserBodySchema = z.object({
  email: z.string().email().optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  role: z.enum(['user', 'admin', 'editor', 'viewer', 'api_only']).optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'pending_verification']).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

export type UpdateUserInput = z.infer<typeof updateUserBodySchema>;

export const dateRangeQuerySchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return data.startDate <= data.endDate;
    }
    return true;
  },
  { message: 'startDate must be before or equal to endDate' }
);

export type DateRangeInput = z.infer<typeof dateRangeQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  search: z.string().min(1).max(200).optional(),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
