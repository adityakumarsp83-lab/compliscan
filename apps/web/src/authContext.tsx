import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, signup as apiSignup, verifyStoredToken, clearToken, getStoredUser } from './apiClient';
import type { AuthUser } from './apiClient';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isOfflineMode: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, fullName: string, inspectorId: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const storedUser = getStoredUser();
      if (storedUser) setUser(storedUser);

      try {
        const verified = await verifyStoredToken();
        if (verified) {
          setUser(verified);
          setIsOfflineMode(false);
        } else if (storedUser) {
          setIsOfflineMode(true);
        } else {
          setUser(null);
        }
      } catch {
        if (storedUser) setIsOfflineMode(true);
      } finally {
        setIsLoading(false);
      }
    }
    bootstrap();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiLogin(username, password);
    setUser(result.user);
    setIsOfflineMode(false);
  }, []);

  const signup = useCallback(async (username: string, password: string, fullName: string, inspectorId: string) => {
    const result = await apiSignup(username, password, fullName, inspectorId);
    setUser(result.user);
    setIsOfflineMode(false);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setIsOfflineMode(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isOfflineMode, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function LoginPage() {
  const { login, signup } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [inspectorId, setInspectorId] = useState('');
  
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      if (isLogin) {
        await login(username, password);
      } else {
        await signup(username, password, fullName, inspectorId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 flex items-center justify-center p-6">
      {/* Official Blue header stripe */}
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-fda-600 via-blue-600 to-fda-600" />

      <div className="w-full max-w-md">
        {/* Logo & Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-fda-600 shadow-lg shadow-fda-600/20 mb-5">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">CompliScan</h1>
          <p className="text-sm text-slate-500 mt-1.5 font-medium">Legal Metrology Enforcement Suite</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="text-[10px] bg-fda-600/10 text-fda-600 px-2.5 py-1 rounded-full font-semibold border border-fda-600/20">SIH-26034</span>
            <span className="text-[10px] bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full font-semibold border border-teal-200">Packaged Food Safety</span>
          </div>
        </div>

        {/* Auth Form Card */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 p-7 space-y-4">
          {/* Tab toggle */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${isLogin ? 'bg-fda-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${!isLogin ? 'bg-fda-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Sign Up
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. jdoe_inspector"
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-fda-500 focus:ring-2 focus:ring-fda-500/20 transition"
              required
            />
          </div>

          {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-fda-500 focus:ring-2 focus:ring-fda-500/20 transition"
                  required={!isLogin}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Inspector ID / Badge #</label>
                <input
                  type="text"
                  value={inspectorId}
                  onChange={(e) => setInspectorId(e.target.value)}
                  placeholder="e.g. LM-001"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-fda-500 focus:ring-2 focus:ring-fda-500/20 transition"
                  required={!isLogin}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-fda-500 focus:ring-2 focus:ring-fda-500/20 transition"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-medium flex items-center justify-between">
              <span>{error}</span>
              {!isLogin && error.includes('already exists') && (
                <button
                  type="button"
                  onClick={() => { setIsLogin(true); setError(''); }}
                  className="ml-2 text-blue-700 hover:text-blue-900 underline font-semibold cursor-pointer shrink-0"
                >
                  Sign In instead
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-fda-600 hover:bg-fda-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 mt-3 shadow-sm shadow-fda-600/20"
          >
            {isLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {isLogin ? 'Authenticating…' : 'Creating Account…'}
              </>
            ) : (
              isLogin ? 'Sign In' : 'Sign Up'
            )}
          </button>
        </form>

        {/* Footer text */}
        <p className="text-center text-[11px] text-slate-400 mt-6">
          Ministry of Consumer Affairs, Food & Public Distribution · Legal Metrology Act, 2009
        </p>
      </div>
    </div>
  );
}
