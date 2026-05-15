import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  Timestamp, 
  doc, 
  getDocFromServer 
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Milk, 
  Wallet, 
  Beef as CowIcon, 
  Plus, 
  LogOut, 
  TrendingUp, 
  TrendingDown,
  ChevronRight,
  User as UserIcon,
  Sparkles,
  Download
} from 'lucide-react';
import { db, auth, signInWithGoogle, logout, OperationType, handleFirestoreError } from './lib/firebase';
import { Cow, MilkSlip, Expense, FinancialSummary, ExpenseCategory } from './types';
import { cn, formatCurrency } from './lib/utils';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { getCostReductionTips } from './services/geminiService';
import html2canvas from 'html2canvas';

// --- Sub-components ---

const AuthScreen = () => (
  <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-farm-bg text-farm-text">
    <motion.div 
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="text-center space-y-8"
    >
      <div className="w-24 h-24 bg-white border border-slate-100 rounded-[32px] flex items-center justify-center mx-auto shadow-sm">
        <CowIcon size={48} className="text-farm-indigo" />
      </div>
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 uppercase">Ksheera-Sagara</h1>
        <p className="text-slate-500 text-lg max-w-xs mx-auto mt-2 font-medium">
          Dairy Profit & Loss Intelligence.
        </p>
      </div>
      <button 
        onClick={signInWithGoogle}
        className="btn-minimal bg-slate-900 text-white w-full max-w-sm py-4 text-sm uppercase tracking-widest"
      >
        <img src="https://www.google.com/favicon.ico" className="w-5 h-5 bg-white rounded-full p-0.5" alt="Google" />
        Login with Google
      </button>
    </motion.div>
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'cows'>('dashboard');
  
  // Data State
  const [cows, setCows] = useState<Cow[]>([]);
  const [slips, setSlips] = useState<MilkSlip[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [aiTips, setAiTips] = useState<{title: string, advice: string}[]>([]);
  const [loadingTips, setLoadingTips] = useState(false);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        testConnection();
      }
    });
    return () => unsubscribeAuth();
  }, []);

  const testConnection = async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if(error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Please check your Firebase configuration.");
      }
    }
  }

  // Data Fetching
  useEffect(() => {
    if (!user) return;

    const qCows = query(collection(db, 'cows'), where('userId', '==', user.uid));
    const unsubCows = onSnapshot(qCows, (snap) => {
      setCows(snap.docs.map(d => ({ id: d.id, ...d.data() } as Cow)));
    }, (err: any) => handleFirestoreError(err, OperationType.LIST, 'cows'));

    const qSlips = query(collection(db, 'milkSlips'), where('userId', '==', user.uid));
    const unsubSlips = onSnapshot(qSlips, (snap) => {
      const data = snap.docs.map(d => {
        const raw = d.data();
        return { 
          id: d.id, 
          ...raw,
          date: (raw.date as Timestamp).toDate().toISOString()
        } as MilkSlip;
      });
      setSlips(data);
    }, (err: any) => handleFirestoreError(err, OperationType.LIST, 'milkSlips'));

    const qExpenses = query(collection(db, 'expenses'), where('userId', '==', user.uid));
    const unsubExpenses = onSnapshot(qExpenses, (snap) => {
      const data = snap.docs.map(d => {
        const raw = d.data();
        return { 
          id: d.id, 
          ...raw,
          date: (raw.date as Timestamp).toDate().toISOString()
        } as Expense;
      });
      setExpenses(data);
    }, (err: any) => handleFirestoreError(err, OperationType.LIST, 'expenses'));

    return () => {
      unsubCows();
      unsubSlips();
      unsubExpenses();
    };
  }, [user]);

  // Calculations
  useEffect(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const monthSlips = slips.filter(s => isWithinInterval(new Date(s.date), { start: monthStart, end: monthEnd }));
    const monthExpenses = expenses.filter(e => isWithinInterval(new Date(e.date), { start: monthStart, end: monthEnd }));

    const totalIncome = monthSlips.reduce((sum, s) => sum + s.amount, 0);
    const totalExpense = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
    const totalLiters = monthSlips.reduce((sum, s) => sum + s.liters, 0);

    const breakdown: Record<ExpenseCategory, number> = {
      Fodder: 0, Medical: 0, Labor: 0, Electricity: 0, Other: 0
    };
    monthExpenses.forEach(e => {
      breakdown[e.category] += e.amount;
    });

    const newSummary: FinancialSummary = {
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
      profitPerLiter: totalLiters > 0 ? (totalIncome - totalExpense) / totalLiters : 0,
      expenseBreakdown: breakdown
    };

    setSummary(newSummary);
  }, [slips, expenses]);

  const fetchAiTips = async () => {
    if (!summary || loadingTips) return;
    setLoadingTips(true);
    const tips = await getCostReductionTips(summary);
    setAiTips(tips);
    setLoadingTips(false);
  };

  const exportReport = async () => {
    const element = document.getElementById('report-area');
    if (!element) return;
    const canvas = await html2canvas(element);
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `ksheera-sagara-report-${format(new Date(), 'MMM-yyyy')}.png`;
    link.href = dataUrl;
    link.click();
  };

  if (loading) return null;
  if (!user) return <AuthScreen />;

  return (
    <div className="pb-32 pt-10 max-w-2xl mx-auto px-6 min-h-screen bg-farm-bg">
      {/* Header */}
      <header className="flex items-center justify-between mb-10">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 uppercase">Ksheera-Sagara</h2>
          <p className="label-caps mt-0.5">{format(new Date(), 'MMMM yyyy')}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="label-caps">Current User</p>
            <p className="text-sm font-bold text-slate-700">{user.displayName || 'Farmer'}</p>
          </div>
          <button onClick={logout} className="p-3 bg-white border border-slate-100 rounded-2xl shadow-sm text-slate-400 hover:text-red-500 transition-colors">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {activeTab === 'dashboard' && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            {/* Profit Card */}
            <div id="report-area" className="minimal-card p-10 flex flex-col justify-center relative overflow-hidden">
               <span className={cn(
                 "text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full self-start mb-6",
                 summary && summary.netProfit >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
               )}>
                 Financial Health: {summary && summary.netProfit >= 0 ? 'Good' : 'Critical'}
               </span>
               <p className="text-slate-500 text-sm font-medium">Net Profit This Month</p>
               <h2 className="text-5xl font-light text-slate-900 mt-2 tracking-tight">
                 {summary ? formatCurrency(summary.netProfit).split('.')[0] : '₹0'}
                 <span className="text-2xl opacity-40">.00</span>
               </h2>
               
               <div className="mt-8 flex items-center gap-4 pt-8 border-t border-slate-50">
                 <div className="flex items-center gap-1 text-emerald-600 font-bold text-sm">
                   <TrendingUp size={16} strokeWidth={3} />
                   <span>+{summary && summary.totalIncome > 0 ? ((summary.netProfit / summary.totalIncome) * 100).toFixed(1) : 0}%</span>
                 </div>
                 <div className="h-4 w-px bg-slate-100" />
                 <p className="text-xs text-slate-400 font-medium tracking-tight">Performance is stable compared to last period</p>
               </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-6">
              <div className="minimal-card p-8 bg-white">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 text-slate-600 border border-slate-100 shadow-sm">
                  <Milk size={24} />
                </div>
                <p className="label-caps mb-1">Profit/Liter</p>
                <p className="text-2xl font-bold text-slate-900">{summary ? formatCurrency(summary.profitPerLiter) : '₹0'}</p>
              </div>
              <div className="minimal-card p-8 bg-white">
                <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 text-slate-600 border border-slate-100 shadow-sm">
                  <CowIcon size={24} />
                </div>
                <p className="label-caps mb-1">Total Herd</p>
                <p className="text-2xl font-bold text-slate-900">{cows.length} Cows</p>
              </div>
            </div>

            {/* Expense Breakdown */}
            <div className="minimal-card p-8 bg-white">
              <div className="flex items-center justify-between mb-8">
                <h4 className="font-bold text-slate-900 tracking-tight text-lg uppercase">Expense Distribution</h4>
                <button onClick={exportReport} className="text-slate-400 p-2 hover:bg-slate-50 rounded-full transition-colors">
                  <Download size={20} />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={summary ? Object.entries(summary.expenseBreakdown).map(([name, value]) => ({ name, value })) : []}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={85}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {Object.entries(summary?.expenseBreakdown || {}).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={['#F97316', '#60A5FA', '#F87171', '#4F46E5', '#94A3B8'][index % 5]} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-4">
                  {summary && Object.entries(summary.expenseBreakdown).map(([name, value], i) => {
                    const val = value as number;
                    const percentage = summary.totalExpense > 0 ? (val / summary.totalExpense) * 100 : 0;
                    return val > 0 && (
                      <div key={name} className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ['#F97316', '#60A5FA', '#F87171', '#4F46E5', '#94A3B8'][i % 5] }} />
                            <span className="text-xs font-bold text-slate-700 uppercase tracking-tight">{name}</span>
                          </div>
                          <span className="text-xs font-bold text-slate-400">{percentage.toFixed(0)}%</span>
                        </div>
                        <div className="w-full h-1 bg-slate-50 rounded-full overflow-hidden">
                          <div 
                            className="h-full transition-all duration-500" 
                            style={{ width: `${percentage}%`, backgroundColor: ['#F97316', '#60A5FA', '#F87171', '#4F46E5', '#94A3B8'][i % 5] }} 
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* AI Suggestions */}
            <div className="dark-card font-sans">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-white/10 rounded-xl text-amber-400">
                  <Sparkles size={20} />
                </div>
                <h4 className="font-bold text-lg tracking-tight uppercase">AI Savings Consultant</h4>
              </div>
              
              {aiTips.length > 0 ? (
                <div className="space-y-6">
                  {aiTips.map((tip, i) => (
                    <div key={i} className="border-b border-white/10 pb-4 last:border-0 last:pb-0">
                      <p className="font-bold text-sm text-emerald-400 mb-1.5">{tip.title}</p>
                      <p className="text-sm text-white/50 leading-relaxed font-medium">{tip.advice}</p>
                    </div>
                  ))}
                  <button 
                    onClick={fetchAiTips}
                    disabled={loadingTips}
                    className="w-full py-4 text-[10px] font-bold uppercase tracking-widest text-white/40 border border-white/5 rounded-2xl hover:bg-white/5 transition-all"
                  >
                    Refresh Analysis
                  </button>
                </div>
              ) : (
                <div className="text-center py-6 bg-white/5 rounded-3xl">
                  <p className="text-sm text-white/60 mb-6 px-6 font-medium italic">"Precision feeding based on SNF metrics is currently your biggest saving opportunity."</p>
                  <div className="px-6">
                    <button 
                      onClick={fetchAiTips}
                      disabled={loadingTips}
                      className="btn-minimal w-full bg-white text-slate-900 shadow-xl"
                    >
                      {loadingTips ? "Intelligence Processing..." : "Generate Insights"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'logs' && (
          <motion.div
            key="logs"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-8"
          >
            <IncomeLogger user={user} cows={cows} />
            <ExpenseLogger user={user} cows={cows} />
          </motion.div>
        )}

        {activeTab === 'cows' && (
          <motion.div
            key="cows"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <CowManager user={user} cows={cows} slips={slips} expenses={expenses} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <nav className="fixed bottom-10 left-6 right-6 bg-white border border-slate-100 shadow-2xl rounded-full p-2 flex items-center justify-around z-50 max-w-2xl mx-auto">
        {[
          { id: 'dashboard', icon: LayoutDashboard, label: 'OVERVIEW' },
          { id: 'logs', icon: Wallet, label: 'LOGS' },
          { id: 'cows', icon: CowIcon, label: 'MY CATTLE' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id as any)}
            className={cn(
              "flex flex-col items-center gap-1 py-3 transition-all rounded-full flex-1",
              activeTab === item.id ? "text-farm-indigo bg-slate-50 font-bold" : "text-slate-400"
            )}
          >
            <item.icon size={22} strokeWidth={activeTab === item.id ? 2.5 : 2} />
            <span className="text-[9px] label-caps tracking-tighter">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// --- Specialized View Components ---

function IncomeLogger({ user, cows }: { user: User, cows: Cow[] }) {
  const [liters, setLiters] = useState('');
  const [fat, setFat] = useState('');
  const [rate, setRate] = useState('');
  const [cowId, setCowId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liters || !rate || loading) return;
    setLoading(true);
    try {
      const amount = parseFloat(liters) * parseFloat(rate);
      await addDoc(collection(db, 'milkSlips'), {
        userId: user.uid,
        cowId: cowId || null,
        liters: parseFloat(liters),
        fat: parseFloat(fat) || 0,
        rate: parseFloat(rate),
        amount,
        date: Timestamp.now(),
        createdAt: new Date().toISOString()
      });
      setLiters('');
      setFat('');
      setCowId('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'milkSlips');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="minimal-card p-8 bg-white">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-indigo-50 rounded-xl text-indigo-500 ring-1 ring-indigo-100">
          <Milk size={20} />
        </div>
        <h4 className="font-bold text-lg tracking-tight uppercase">Log Daily Milk Slip</h4>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="label-caps mb-2 block">Source Asset</label>
          <select 
            value={cowId}
            onChange={e => setCowId(e.target.value)}
            className="input-minimal"
          >
            <option value="">General Herd Collection</option>
            {cows.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="label-caps mb-2 block">Volume (Liters)</label>
            <input 
              type="number" step="0.1" 
              value={liters} onChange={e => setLiters(e.target.value)}
              className="input-minimal" placeholder="0.0" 
            />
          </div>
          <div>
            <label className="label-caps mb-2 block">Fat Percentage</label>
            <input 
              type="number" step="0.1" 
              value={fat} onChange={e => setFat(e.target.value)}
              className="input-minimal" placeholder="4.2" 
            />
          </div>
        </div>
        <div>
          <label className="label-caps mb-2 block">Market Rate (₹/L)</label>
          <input 
            type="number" 
            value={rate} onChange={e => setRate(e.target.value)}
            className="input-minimal" placeholder="42" 
          />
        </div>
        <button type="submit" disabled={loading} className="btn-minimal w-full bg-slate-900 text-white tracking-widest text-xs py-4 shadow-xl">
          {loading ? "DATA PROCESSING..." : "COMMIT RECORD"}
        </button>
      </form>
    </div>
  );
}

function ExpenseLogger({ user, cows }: { user: User, cows: Cow[] }) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Fodder');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || loading) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'expenses'), {
        userId: user.uid,
        amount: parseFloat(amount),
        category,
        description,
        date: Timestamp.now(),
        createdAt: new Date().toISOString()
      });
      setAmount('');
      setDescription('');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'expenses');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="minimal-card p-8 bg-white border-none">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-slate-50 rounded-xl text-slate-900 border border-slate-100">
          <Wallet size={20} />
        </div>
        <h4 className="font-bold text-lg tracking-tight uppercase">Log Operational Expense</h4>
      </div>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="label-caps mb-3 block">Classification</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(['Fodder', 'Medical', 'Labor', 'Electricity', 'Other'] as ExpenseCategory[]).map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={cn(
                  "py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all border",
                  category === cat ? "bg-white border-slate-900 text-slate-900 shadow-sm" : "bg-slate-50 border-transparent text-slate-400"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label-caps mb-2 block">Numerical Value (₹)</label>
          <input 
            type="number" 
            value={amount} onChange={e => setAmount(e.target.value)}
            className="input-minimal" placeholder="0" 
          />
        </div>
        <div>
          <label className="label-caps mb-2 block">Reference Note</label>
          <input 
            type="text" 
            value={description} onChange={e => setDescription(e.target.value)}
            className="input-minimal" placeholder="Feed purchase - Batch A..." 
          />
        </div>
        <button type="submit" disabled={loading} className="btn-minimal w-full border border-slate-200 bg-white text-slate-900 tracking-widest text-xs py-4">
          {loading ? "DATA PROCESSING..." : "COMMIT EXPENSE"}
        </button>
      </form>
    </div>
  );
}

function CowManager({ user, cows, slips, expenses }: { user: User, cows: Cow[], slips: MilkSlip[], expenses: Expense[] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [tagNumber, setTagNumber] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || loading) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'cows'), {
        userId: user.uid,
        name,
        tagNumber,
        createdAt: new Date().toISOString()
      });
      setName('');
      setTagNumber('');
      setShowAdd(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'cows');
    } finally {
      setLoading(false);
    }
  };

  const getCowProfit = (id: string) => {
    const income = slips.filter(s => s.cowId === id).reduce((sum, s) => sum + s.amount, 0);
    const expense = expenses.filter(e => e.cowId === id).reduce((sum, e) => sum + e.amount, 0);
    return income - expense;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight uppercase">Cattle Portfolio</h3>
          <p className="label-caps mt-1">Total active units: {cows.length}</p>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="p-3 bg-slate-900 text-white rounded-2xl shadow-xl active:scale-95 transition-all"
        >
          {showAdd ? <ChevronRight size={20} className="rotate-90" /> : <Plus size={20} />}
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleAdd} className="minimal-card p-8 bg-white space-y-6 mb-8">
              <h4 className="font-bold text-slate-900 tracking-tight uppercase">New Animal Registration</h4>
              <div>
                <label className="label-caps mb-2 block">Identifier Name</label>
                <input 
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  className="input-minimal" placeholder="Ganga / Lakshmi" 
                />
              </div>
              <div>
                <label className="label-caps mb-2 block">Tag Reference</label>
                <input 
                  type="text" value={tagNumber} onChange={e => setTagNumber(e.target.value)}
                  className="input-minimal" placeholder="UID-00000" 
                />
              </div>
              <button type="submit" disabled={loading} className="btn-minimal w-full bg-slate-900 text-white tracking-widest text-xs py-4">
                {loading ? "REGISTERING..." : "COMMIT REGISTRATION"}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="dark-card p-10 space-y-8">
        <div className="flex justify-between items-center mb-2">
            <h4 className="label-caps !text-white/40">Cow Performance Matrix</h4>
            <span className="text-[10px] text-white/20 uppercase tracking-widest">REAL-TIME SYNC</span>
        </div>
        
        <div className="space-y-6">
          {cows.length === 0 ? (
            <div className="text-center py-10 text-white/20">
               <CowIcon size={48} className="mx-auto mb-4 opacity-5" />
               <p className="text-xs uppercase tracking-widest">No active cattle records found.</p>
            </div>
          ) : cows.map(cow => {
            const profit = getCowProfit(cow.id);
            return (
              <div key={cow.id} className="flex items-center justify-between group border-b border-white/5 pb-6 last:border-0 last:pb-0">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 bg-white/5 rounded-[20px] flex items-center justify-center text-white/80 border border-white/10 group-hover:bg-white/10 transition-colors">
                    <CowIcon size={28} />
                  </div>
                  <div>
                    <h5 className="font-bold text-lg text-white leading-tight">{cow.name}</h5>
                    <p className="text-[10px] text-white/40 font-mono tracking-tighter uppercase mt-1">{cow.tagNumber || 'NO REFERENCE TAG'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold tracking-widest text-white/40 mb-1.5">Net Position</p>
                  <p className={cn(
                    "font-bold text-xl tracking-tight",
                    profit >= 0 ? "text-emerald-400" : "text-red-400"
                  )}>{formatCurrency(profit)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
