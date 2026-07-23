import React, { useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

/**
 * Scanner uses the Html5Qrcode API (not Html5QrcodeScanner) to
 * directly request the rear/environment camera — best for phones.
 * When a QR is decoded, onScan(decodedText) is called.
 * The scanner pauses itself and will only resume when resumeScan() is called.
 */
const Scanner = ({ onScan }) => {
  const scannerRef = useRef(null);
  const isRunningRef = useRef(false);

  const startScanner = useCallback(async () => {
    if (isRunningRef.current) return;

    const html5Qrcode = new Html5Qrcode('qr-reader-region');
    scannerRef.current = html5Qrcode;

    const config = {
      fps: 15,
      qrbox: { width: 260, height: 260 },
      aspectRatio: 1.0,
      // Prefer the rear (environment) camera on phones
      videoConstraints: {
        facingMode: { ideal: 'environment' },
      },
    };

    try {
      await html5Qrcode.start(
        { facingMode: { ideal: 'environment' } },
        config,
        (decodedText) => {
          if (!isRunningRef.current) return;
          isRunningRef.current = false;
          html5Qrcode.pause(true);
          onScan(decodedText, () => {
            // Resume scanning after the parent signals done
            html5Qrcode.resume();
            isRunningRef.current = true;
          });
        },
        () => {} // ignore frame-level errors
      );
      isRunningRef.current = true;
    } catch (err) {
      console.error('Camera start failed:', err);
    }
  }, [onScan]);

  useEffect(() => {
    startScanner();
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
      isRunningRef.current = false;
    };
  }, [startScanner]);

  return (
    <div className="w-full">
      <div
        id="qr-reader-region"
        className="w-full overflow-hidden"
        style={{ minHeight: '280px' }}
      />
    </div>
  );
};

export default Scanner;
