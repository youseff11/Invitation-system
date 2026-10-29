import { useQuery } from '@tanstack/react-query'

import { fetchBootstrap, fetchSchema } from './api'
import type { EditorMode } from './types'

/** السكيما ثابتة لكل نشر (والسيرفر بيرد ‎304‎ بالـETag) فمفيش داعي نعيد جلبها أثناء الجلسة. */
export const useSchema = () =>
  useQuery({ queryKey: ['editor', 'schema'], queryFn: fetchSchema, staleTime: Infinity, gcTime: Infinity })

/** بيانات فتح المحرر. ‎gcTime: 0‎: مانخزّنش مستند قديم — كل فتحة بتجيب آخر نسخة محفوظة. */
export const useBootstrap = (mode: EditorMode, id: number) =>
  useQuery({
    queryKey: ['editor', 'bootstrap', mode, id],
    queryFn: () => fetchBootstrap(mode, id),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
