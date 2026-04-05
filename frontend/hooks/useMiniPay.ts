'use client';

import { useState } from 'react';

export function useIsMiniPay() {
  const [isMiniPay] = useState(() => typeof window !== 'undefined' && !!(window.ethereum?.isMiniPay));
  return isMiniPay;
}
