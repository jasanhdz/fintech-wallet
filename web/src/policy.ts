import { useQuery } from '@tanstack/react-query';
import type { ProductComponents } from '@fintech-wallet/shared';
import { request } from './api.js';
import { useSession } from './session.js';

export type TransferPolicy = ProductComponents['schemas']['TransferPolicy'];

/** Server-authoritative demo policy (limits, OTP threshold, demoOnly). No figure is hard-coded in the Web. */
export function useTransferPolicy() {
  const { session } = useSession();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['transfer-policy', userId],
    queryFn: () => request<TransferPolicy>('/transfer-policy'),
    enabled: Boolean(userId),
    staleTime: 0,
  });
}
