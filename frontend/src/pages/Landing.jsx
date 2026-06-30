import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { HiEye, HiEyeOff, HiArrowRight, HiArrowLeft } from 'react-icons/hi';
import useAuthStore from '../store/useAuthStore';
import { isPasswordStrong } from '../utils/validation';
import AppLogo from '../components/AppLogo';

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo({ size = 'md' }) {
  const logoSize = size === 'sm' ? 220 : 320;
  return (
    <div className="flex-shrink-0 logo-badge">
      <AppLogo size={logoSize} />
    </div>
  );
}

// ── Password eye toggle ────────────────────────────────────────────────────────
function EyeBtn({ show, onToggle }) {
  return (
    <button type="button" onClick={onToggle}
      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
      {show ? <HiEyeOff className="w-5 h-5" /> : <HiEye className="w-5 h-5" />}
    </button>
  );
}

// ── Shared input style ─────────────────────────────────────────────────────────
const inputCls =
  'w-full px-4 py-3 bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition text-sm font-medium';

const labelCls = 'block text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-widest';

// ── Sign In ───────────────────────────────────────────────────────────────────
function SignInForm({ setView }) {
  const [email, setEmail]     = useState('');
  const [password, setPass]   = useState('');
  const [showPass, setShow]   = useState(false);
  const { login, loading }    = useAuthStore();
  const navigate              = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Please fill in all fields'); return; }
    try {
      await login(email, password);
      toast.success('Access Granted');
      navigate('/ai');
    } catch (err) {
      toast.error(err.message || 'Authentication failed');
    }
  };

  return (
    <div key="signin" className="animate-fade-in-scale">
      <div className="mb-8">
        <h2 className="text-3xl font-black tracking-tight text-gray-900 mb-1.5">Sign In</h2>
        <p className="text-sm text-gray-500">Access the AI Assistant.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelCls}>Email or Username</label>
          <input type="text" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Enter your email or username" className={inputCls} autoComplete="username" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls.replace('mb-2', '')}>Password</label>
            <button type="button" onClick={() => setView('reset')}
              className="text-[11px] font-bold text-cyan-500 hover:text-cyan-400 transition uppercase tracking-widest">
              Forgot?
            </button>
          </div>
          <div className="relative">
            <input type={showPass ? 'text' : 'password'} value={password}
              onChange={e => setPass(e.target.value)} placeholder="••••••••"
              className={`${inputCls} pr-12`} autoComplete="current-password" />
            <EyeBtn show={showPass} onToggle={() => setShow(p => !p)} />
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 mt-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 text-sm uppercase tracking-widest shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:-translate-y-0.5 active:translate-y-0">
          {loading
            ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Launching...</>
            : <>Launch Agent <HiArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <p className="text-center mt-6 text-sm text-gray-500">
        Don't have an account?{' '}
        <button onClick={() => setView('signup')}
          className="text-cyan-500 hover:text-cyan-400 font-bold transition">
          Create Account
        </button>
      </p>
    </div>
  );
}

// ── Sign Up ───────────────────────────────────────────────────────────────────
function SignUpForm({ setView }) {
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirmPassword: '' });
  const [showPass, setShow]    = useState(false);
  const [showConf, setShowC]   = useState(false);
  const { signup, loading }    = useAuthStore();
  const navigate               = useNavigate();

  const handle = e => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { name, username, email, password, confirmPassword } = form;
    if (!name || !username || !email || !password || !confirmPassword) {
      toast.error('Please fill in all fields'); return;
    }
    if (password !== confirmPassword) { toast.error('Passwords do not match'); return; }
    const v = isPasswordStrong(password);
    if (!v.isValid) { toast.error(v.message); return; }
    try {
      await signup({ name, username, email, password });
      toast.success('Account Created');
      navigate('/ai');
    } catch (err) {
      toast.error(err.message || 'Signup failed');
    }
  };

  return (
    <div key="signup" className="animate-fade-in-scale">
      <div className="mb-6">
        <h2 className="text-3xl font-black tracking-tight text-gray-900 mb-1.5">Create Account</h2>
        <p className="text-sm text-gray-500">Set up your AI assistant access.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Full Name</label>
            <input name="name" type="text" value={form.name} onChange={handle}
              placeholder="Jane Doe" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Username</label>
            <input name="username" type="text" value={form.username} onChange={handle}
              placeholder="jane_ani" className={inputCls} autoComplete="username" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Email</label>
          <input name="email" type="email" value={form.email} onChange={handle}
            placeholder="jane@example.com" className={inputCls} autoComplete="email" />
        </div>

        <div>
          <label className={labelCls}>Password</label>
          <div className="relative">
            <input name="password" type={showPass ? 'text' : 'password'} value={form.password}
              onChange={handle} placeholder="••••••••"
              className={`${inputCls} pr-12`} autoComplete="••••••••" />
            <EyeBtn show={showPass} onToggle={() => setShow(p => !p)} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Confirm Password</label>
          <div className="relative">
            <input name="confirmPassword" type={showConf ? 'text' : 'password'} value={form.confirmPassword}
              onChange={handle} placeholder="••••••••" className={`${inputCls} pr-12`} autoComplete="new-password" />
            <EyeBtn show={showConf} onToggle={() => setShowC(p => !p)} />
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 text-sm uppercase tracking-widest shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:-translate-y-0.5 active:translate-y-0">
          {loading
            ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Creating...</>
            : <>Create Account <HiArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <p className="text-center mt-5 text-sm text-gray-500">
        Already have an account?{' '}
        <button onClick={() => setView('signin')}
          className="text-cyan-500 hover:text-cyan-400 font-bold transition">
          Sign In
        </button>
      </p>
    </div>
  );
}

// ── Password Reset ─────────────────────────────────────────────────────────────
function ResetForm({ setView }) {
  const [username,  setUser]  = useState('');
  const [oldPass,   setOld]   = useState('');
  const [newPass,   setNew]   = useState('');
  const [confPass,  setConf]  = useState('');
  const [showOld,   setSO]    = useState(false);
  const [showNew,   setSN]    = useState(false);
  const [showConf,  setSC]    = useState(false);
  const { updatePassword, loading } = useAuthStore();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !oldPass || !newPass || !confPass) {
      toast.error('Please fill in all fields'); return;
    }
    if (newPass !== confPass) { toast.error('New passwords do not match'); return; }
    const v = isPasswordStrong(newPass);
    if (!v.isValid) { toast.error(v.message); return; }
    try {
      await updatePassword(username, oldPass, newPass);
      toast.success('Password updated');
      setView('signin');
    } catch (err) {
      toast.error(err.message || 'Failed to update password');
    }
  };

  return (
    <div key="reset" className="animate-fade-in-scale">
      <div className="mb-6">
        <h2 className="text-3xl font-black tracking-tight text-gray-900 mb-1.5">Reset Password</h2>
        <p className="text-sm text-gray-500">Verify your current password to set a new one.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={labelCls}>Username or Email</label>
          <input type="text" value={username} onChange={e => setUser(e.target.value)}
            placeholder="Enter your email or username" className={inputCls} autoComplete="username" />
        </div>

        <div>
          <label className={labelCls}>Current Password</label>
          <div className="relative">
            <input type={showOld ? 'text' : 'password'} value={oldPass}
              onChange={e => setOld(e.target.value)} placeholder="••••••••"
              className={`${inputCls} pr-12`} autoComplete="current-password" />
            <EyeBtn show={showOld} onToggle={() => setSO(p => !p)} />
          </div>
        </div>

        <div className="pt-1 border-t border-gray-100">
          <div className="pt-3">
            <label className={labelCls}>New Password</label>
            <div className="relative">
              <input type={showNew ? 'text' : 'password'} value={newPass}
                onChange={e => setNew(e.target.value)} placeholder="••••••••"
                className={`${inputCls} pr-12`} autoComplete="new-password" />
              <EyeBtn show={showNew} onToggle={() => setSN(p => !p)} />
            </div>
          </div>

          <div className="mt-4">
            <label className={labelCls}>Confirm New Password</label>
            <div className="relative">
              <input type={showConf ? 'text' : 'password'} value={confPass}
                onChange={e => setConf(e.target.value)} placeholder="••••••••"
                className={`${inputCls} pr-12`} autoComplete="new-password" />
              <EyeBtn show={showConf} onToggle={() => setSC(p => !p)} />
            </div>
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all duration-200 flex items-center justify-center gap-2.5 text-sm uppercase tracking-widest shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:-translate-y-0.5 active:translate-y-0">
          {loading
            ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Updating...</>
            : <>Update Password <HiArrowRight className="w-4 h-4" /></>}
        </button>
      </form>

      <button onClick={() => setView('signin')}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition mt-5 -ml-0.5">
        <HiArrowLeft className="w-4 h-4" /> Back to Sign In
      </button>
    </div>
  );
}

// ── Landing page (shell) ───────────────────────────────────────────────────────
export default function Landing() {
  const [view, setView] = useState('signin'); // 'signin' | 'signup' | 'reset'

  return (
    <div className="min-h-screen w-full flex bg-white text-gray-900 overflow-hidden">

      {/* ── Left — Hero (desktop only) ───────────────────────── */}
      <div className="hidden lg:flex flex-1 flex-col justify-center px-14 xl:px-20 py-16 relative overflow-hidden">

        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-100 rounded-full blur-3xl opacity-40 -translate-x-1/3 -translate-y-1/3 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-cyan-100 rounded-full blur-3xl opacity-40 translate-x-1/4 translate-y-1/4 pointer-events-none" />

        <div className="relative z-10 max-w-xl">
          <div className="mb-14"><Logo /></div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-50 border border-cyan-200 mb-8">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
            <span className="text-xs font-bold text-cyan-600 tracking-wide">AI-Powered Pharmaceutical Operations</span>
          </div>

          <h2 className="text-5xl xl:text-6xl font-black leading-[1.1] tracking-tight mb-6">
            <span className="text-gray-900">Pharmaceutical Intelligence,</span><br />
            <span className="bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-400 bg-clip-text text-transparent">
              Redefined
            </span>
          </h2>

          <p className="text-base text-gray-500 leading-relaxed font-light max-w-md">
            AI-powered assistant for batch records, quality inspections, equipment
            management, and inventory operations — built for pharmaceutical manufacturing.
          </p>

          <div className="flex items-center gap-2 mt-10">
            <div className="w-8 h-1 bg-cyan-500 rounded-full" />
            <div className="w-3 h-1 bg-cyan-300 rounded-full" />
            <div className="w-2 h-1 bg-cyan-200 rounded-full" />
          </div>
        </div>
      </div>

      {/* Vertical divider */}
      <div className="hidden lg:block w-px bg-gray-100 my-12 flex-shrink-0" />

      {/* ── Right — Auth card ─────────────────────────────────── */}
      <div className="flex-1 lg:flex-none lg:w-[480px] flex flex-col justify-center items-center px-8 sm:px-12 py-10 overflow-y-auto">

        {/* Mobile logo */}
        <div className="flex lg:hidden mb-10"><Logo size="sm" /></div>

        {/* Card — grows to fit the active form */}
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 shadow-xl shadow-gray-100/80 p-8">
          {view === 'signin' && <SignInForm setView={setView} />}
          {view === 'signup' && <SignUpForm setView={setView} />}
          {view === 'reset'  && <ResetForm  setView={setView} />}
        </div>
      </div>
    </div>
  );
}
