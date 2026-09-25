import React, { useState, useEffect, useCallback } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import Scanner from './Scanner';
import {
  Lock,
  CheckCircle2,
  XCircle,
  Loader2,
  LogOut,
  User,
  CreditCard,
  BookOpen,
  Ticket,
  AlertTriangle,
  Camera,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Payment validation helper — swap this out when Razorpay is integrated
// ─────────────────────────────────────────────────────────────────────────────
const isPaymentValid = (data) => data?.paymentStatus === 'paid';

// ─────────────────────────────────────────────────────────────────────────────
// Core check-in logic — reads currentDay from Firestore config/event
// ─────────────────────────────────────────────────────────────────────────────
async function processCheckIn(uid) {
  // 1. Fetch current event day from config
  const configSnap = await getDoc(doc(db, 'config', 'event'));
  const currentDay = configSnap.exists() ? configSnap.data().currentDay : 1;

  // 2. Fetch registration
  const regRef = doc(db, 'registrations', uid);
  const regSnap = await getDoc(regRef);

  if (!regSnap.exists()) {
    return { status: 'INVALID_PASS', participant: null, currentDay };
  }

  const data = regSnap.data();
  const participant = {
    name: data.name || data.firstName || 'Unknown',
    college: data.college || data.companyName || '—',
    passType: data.passType || 'Unknown',
    paymentStatus: data.paymentStatus || 'pending',
    role: data.role || '',
  };

  // 3. Day-based check-in field mapping
  const dayMap = {
    1: { checkedIn: 'checkedInDay1', checkInTime: 'day1CheckInTime' },
    2: { checkedIn: 'checkedInDay2', checkInTime: 'day2CheckInTime' },
  };
  const fields = dayMap[currentDay] || dayMap[1];

  if (data[fields.checkedIn]) {
    // Already checked in today
    const ts = data[fields.checkInTime];
    const timeString = ts?.toDate
      ? ts.toDate().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : 'earlier';
    return { status: 'ALREADY_CHECKED_IN', participant, currentDay, checkedInAt: timeString };
  }

  // 4. Grant entry
  await updateDoc(regRef, {
    [fields.checkedIn]: true,
    [fields.checkInTime]: serverTimestamp(),
  });

  return { status: 'ENTRY_GRANTED', participant, currentDay };
}

// ─────────────────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────────────────

const InfoRow = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-3 border-b-2 border-black/10 pb-3">
    <Icon className="w-4 h-4 shrink-0 text-gray-400" />
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="font-black text-sm uppercase">{value}</p>
    </div>
  </div>
);

const ResultBanner = ({ result, onDismiss }) => {
  if (!result) return null;

  const isGranted = result.status === 'ENTRY_GRANTED';
  const isAlready = result.status === 'ALREADY_CHECKED_IN';
  const isInvalid = result.status === 'INVALID_PASS';

  return (
    <div
      className={`border-4 border-black shadow-[6px_6px_0px_rgba(0,0,0,1)] p-6
        ${isGranted ? 'bg-green-400' : isAlready ? 'bg-yellow-400' : 'bg-red-400'}`}
    >
      {/* Status header */}
      <div className="flex items-start gap-3 mb-4">
        {isGranted ? (
          <CheckCircle2 className="w-10 h-10 shrink-0" />
        ) : isAlready ? (
          <AlertTriangle className="w-10 h-10 shrink-0" />
        ) : (
          <XCircle className="w-10 h-10 shrink-0" />
        )}
        <div>
          <h2 className="font-black uppercase tracking-tight text-2xl leading-none">
            {isGranted ? '✔ Entry Granted' : isAlready ? '⚠ Already Checked In' : '✘ Invalid Pass'}
          </h2>
          {isAlready && (
            <p className="font-bold text-sm mt-1 opacity-80">
              Entered at {result.checkedInAt} · Day {result.currentDay}
            </p>
          )}
          {isInvalid && (
            <p className="font-bold text-sm mt-1 opacity-80">
              No registration found for this QR code.
            </p>
          )}
        </div>
      </div>

      {/* Participant info */}
      {result.participant && (
        <div className="bg-white/60 border-2 border-black p-4 space-y-3 mb-4">
          <InfoRow icon={User} label="Name" value={result.participant.name} />
          <InfoRow
            icon={BookOpen}
            label={result.participant.role === 'startup' ? 'Company' : 'College'}
            value={result.participant.college}
          />
          <InfoRow icon={Ticket} label="Pass Type" value={result.participant.passType} />
          <InfoRow
            icon={CreditCard}
            label="Payment"
            value={result.participant.paymentStatus}
          />
        </div>
      )}

      <button
        onClick={onDismiss}
        className="w-full py-3 font-black uppercase tracking-widest text-sm border-4 border-black bg-black text-white hover:bg-white hover:text-black transition-colors"
      >
        Scan Next →
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecking, setAdminChecking] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [scanResult, setScanResult] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scannerKey, setScannerKey] = useState(0); // force remount Scanner to restart
  const [isScanning, setIsScanning] = useState(false);

  // Auth listener
  useEffect(() => {
    // Safety timeout — never let the spinner show forever
    const timeout = setTimeout(() => {
      setAuthLoading(false);
      setAdminChecking(false);
    }, 5000);

    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout);
      setAuthUser(user);
      if (user) {
        setAdminChecking(true);
        try {
          if (user.uid === 'QbTRlKoEQ0bpgfcWEhtMw6fG51I2') {
            setIsAdmin(true);
          } else {
            const adminSnap = await getDoc(doc(db, 'admins', user.uid));
            setIsAdmin(adminSnap.exists());
          }
        } catch (error) {
          console.error("Error fetching admin status:", error);
          setIsAdmin(user.uid === 'QbTRlKoEQ0bpgfcWEhtMw6fG51I2');
        } finally {
          setAdminChecking(false);
        }
      } else {
        setIsAdmin(false);
      }
      setAuthLoading(false);
    });
    return () => {
      clearTimeout(timeout);
      unsub();
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setLoginError('Incorrect email or password.');
    }
    setLoginLoading(false);
  };

  const handleLogout = () => signOut(auth);

  const handleScan = useCallback(async (uid, resumeScan) => {
    setIsProcessing(true);
    setScanResult(null);
    try {
      const result = await processCheckIn(uid);
      setScanResult(result);
    } catch (err) {
      setScanResult({ status: 'INVALID_PASS', participant: null, error: err.message });
    }
    setIsProcessing(false);
  }, []);

  const handleDismiss = () => {
    setScanResult(null);
    setIsScanning(false);
    setScannerKey((k) => k + 1); // remount scanner so it restarts cleanly
  };

  // ── Loading ──
  if (authLoading || adminChecking) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#fffefa]">
        <div className="w-16 h-16 bg-[#1f2022] border-4 border-black flex items-center justify-center shadow-[4px_4px_0px_rgba(0,0,0,1)]">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
        </div>
        <p className="font-black uppercase tracking-widest text-sm text-gray-500">
          {adminChecking ? 'Verifying admin access…' : 'Connecting to Firebase…'}
        </p>
      </div>
    );
  }

  // ── Login screen ──
  if (!authUser) {
    return (
      <div className="min-h-screen bg-[#fffefa] flex items-center justify-center p-4">
        <form
          onSubmit={handleLogin}
          className="bg-white p-8 border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] w-full max-w-sm space-y-5"
        >
          <div className="flex justify-center">
            <div className="w-16 h-16 bg-[#1f2022] border-4 border-black flex items-center justify-center shadow-[4px_4px_0px_rgba(0,0,0,1)]">
              <Lock className="w-8 h-8 text-white" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-black uppercase tracking-tight">Admin Scanner</h1>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
              Startup Peravai Gate
            </p>
          </div>

          {loginError && (
            <p className="text-sm font-bold text-red-600 text-center border-2 border-red-400 p-2 bg-red-50">
              {loginError}
            </p>
          )}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border-4 border-black px-4 py-3 font-bold focus:outline-none focus:bg-gray-50 text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border-4 border-black px-4 py-3 font-bold focus:outline-none focus:bg-gray-50 text-sm"
          />
          <button
            type="submit"
            disabled={loginLoading}
            className="w-full py-4 bg-[#1f2022] text-white font-black uppercase tracking-[0.15em] border-4 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50"
          >
            {loginLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Sign In →'}
          </button>
        </form>
      </div>
    );
  }

  // ── Access denied (signed in but not admin) ──
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#fffefa] flex items-center justify-center p-4">
        <div className="bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-8 max-w-sm w-full text-center space-y-4">
          <XCircle className="w-16 h-16 text-red-600 mx-auto" />
          <h1 className="text-2xl font-black uppercase tracking-tight">Access Denied</h1>
          <p className="font-bold text-gray-500 text-sm">
            Your account ({authUser.email}) is not authorised as an admin.
          </p>
          <button
            onClick={handleLogout}
            className="w-full py-3 border-4 border-black font-black uppercase tracking-widest text-sm hover:bg-black hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // ── Scanner UI ──
  return (
    <div className="min-h-screen bg-[#fffefa] font-sans">
      {/* Header */}
      <div className="border-b-4 border-black bg-[#1f2022] px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-black uppercase tracking-tight text-white text-lg leading-none">
            Gate Scanner
          </h1>
          <p className="text-xs font-bold text-white/50 uppercase tracking-widest">
            Startup Peravai 2026
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 border-2 border-white/30 text-white font-bold text-xs uppercase tracking-widest hover:bg-white/10 transition-colors"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* Idle State — Click to Scan */}
        {!isScanning && !scanResult && !isProcessing && (
          <button
            onClick={() => setIsScanning(true)}
            className="w-full py-16 border-4 border-black bg-white shadow-[6px_6px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all flex flex-col items-center gap-4"
          >
            <Camera className="w-12 h-12" />
            <span className="font-black uppercase tracking-widest text-lg">Click here to scan</span>
          </button>
        )}

        {/* Scanner panel — hide when result is showing */}
        {isScanning && !scanResult && !isProcessing && (
          <div className="border-4 border-black bg-white shadow-[6px_6px_0px_rgba(0,0,0,1)] relative">
            <button
              onClick={() => setIsScanning(false)}
              className="absolute top-2 right-2 z-10 w-8 h-8 bg-black text-white flex items-center justify-center rounded-full hover:bg-gray-800 transition-colors"
              aria-label="Close Scanner"
            >
              <XCircle className="w-5 h-5" />
            </button>
            <div className="border-b-4 border-black px-4 py-3 flex items-center gap-2 bg-black text-white">
              <Camera className="w-5 h-5" />
              <span className="font-black uppercase tracking-widest text-sm">
                Point camera at QR
              </span>
            </div>
            <div className="p-2">
              <Scanner key={scannerKey} onScan={handleScan} />
            </div>
          </div>
        )}

        {/* Processing */}
        {isProcessing && (
          <div className="border-4 border-black bg-white shadow-[6px_6px_0px_rgba(0,0,0,1)] p-8 flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin" />
            <p className="font-black uppercase tracking-widest text-sm">Checking in…</p>
          </div>
        )}

        {/* Result */}
        {!isProcessing && scanResult && (
          <ResultBanner result={scanResult} onDismiss={handleDismiss} />
        )}
      </div>
    </div>
  );
}
