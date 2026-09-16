'use client';

import { useEffect } from 'react';
import { createClient } from '../utils/supabase/client';

const TIMEOUT = 60 * 60 * 1000; // 1 jam tanpa aktivitas

export default function SessionTimeout() {
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);

      timer = setTimeout(async () => {
        await supabase.auth.signOut();
        window.location.href = '/access';
      }, TIMEOUT);
    };

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, []);

  return null;
}
