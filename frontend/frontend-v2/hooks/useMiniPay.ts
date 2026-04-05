'use client';

import { useState, useEffect } from 'react';

export function useIsMiniPay() {
  const [isMiniPay, setIsMiniPay] = useState(false);

  useEffect(() => {
    const detected = !!(window.ethereum?.isMiniPay);
    setIsMiniPay(detected);
  }, []);

  return isMiniPay;
}
