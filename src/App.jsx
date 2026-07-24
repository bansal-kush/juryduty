import React, { useState, useEffect } from 'react';
import './App.css';
import initialMockCases from './mockData.json';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Retro Sound Generator (No asset dependencies!)
const playRetroGavelSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Gavel thump (low wooden impact)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(120, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.15);
    gain1.gain.setValueAtTime(0.6, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.2);

    // Gavel desk click (sharper high-frequency click)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(600, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.05);
    gain2.gain.setValueAtTime(0.15, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start();
    osc2.stop(ctx.currentTime + 0.06);

  } catch (e) {
    console.error("Audio Context error", e);
  }
};

const playRetroSuccessSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    
    // Cute 8-bit arcade chime
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    
    osc.frequency.setValueAtTime(261.63, now); // C4
    osc.frequency.setValueAtTime(329.63, now + 0.1); // E4
    osc.frequency.setValueAtTime(392.00, now + 0.2); // G4
    osc.frequency.setValueAtTime(523.25, now + 0.3); // C5
    
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.55);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(now + 0.6);
  } catch (e) {
    console.error("Audio Context error", e);
  }
};

function App() {
  // Screen States: 'home' | 'courtroom' | 'submit'
  const [view, setView] = useState('home');
  const [cases, setCases] = useState([]);
  const [votedCaseIds, setVotedCaseIds] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [isJudgeMode, setIsJudgeMode] = useState(false);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [gavelBanging, setGavelBanging] = useState(false);
  const [showToast, setShowToast] = useState('');

  // Submit Case Form State
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState('relationships');
  const [formPunishment, setFormPunishment] = useState('');

  // Load cases and localStorage on mount
  useEffect(() => {
    // 1. Get voted case IDs
    const savedVotes = localStorage.getItem('juryduty_votes');
    const parsedVotes = savedVotes ? JSON.parse(savedVotes) : [];
    setVotedCaseIds(parsedVotes);

    // 2. Fetch cases from Supabase
    const fetchCases = async () => {
      try {
        const { data, error } = await supabase
          .from('cases')
          .select('*')
          .order('id', { ascending: false });
        
        if (error) throw error;
        if (data && data.length > 0) {
          setCases(data);
        } else {
          setCases(initialMockCases);
        }
      } catch (err) {
        console.error("Error fetching cases from Supabase, using mock data:", err);
        setCases(initialMockCases);
      }
    };

    fetchCases();

    // 3. Realtime updates subscription
    const channel = supabase
      .channel('realtime_cases')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cases' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            setCases(prev => prev.map(c => c.id === payload.new.id ? payload.new : c));
            setSelectedCase(prev => prev && prev.id === payload.new.id ? payload.new : prev);
          } else if (payload.eventType === 'INSERT') {
            setCases(prev => [payload.new, ...prev]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const triggerToast = (msg) => {
    setShowToast(msg);
    setTimeout(() => {
      setShowToast('');
    }, 2000);
  };

  const handleVote = (caseId, type) => {
    if (votedCaseIds.includes(caseId)) return;

    // Start gavel animation and play audio
    setGavelBanging(true);
    playRetroGavelSound();

    setTimeout(async () => {
      // Find the case and calculate updated votes
      const targetCase = cases.find(c => c.id === caseId);
      if (!targetCase) return;

      const column = type === 'guilty' ? 'guilty_votes' : 'not_guilty_votes';
      const updatedValue = targetCase[column] + 1;

      // Update in Supabase
      try {
        const { data, error } = await supabase
          .from('cases')
          .update({ [column]: updatedValue })
          .eq('id', caseId)
          .select()
          .single();
        
        if (error) throw error;
        
        if (data) {
          setCases(prev => prev.map(c => c.id === caseId ? data : c));
          setSelectedCase(data);
        }
      } catch (err) {
        console.error("Error updating vote in Supabase:", err);
        // Fallback to local state update if DB write fails
        const updatedCases = cases.map(c => {
          if (c.id === caseId) {
            return {
              ...c,
              [column]: updatedValue
            };
          }
          return c;
        });
        setCases(updatedCases);
        const updatedCaseObj = updatedCases.find(c => c.id === caseId);
        setSelectedCase(updatedCaseObj);
      }

      // Save to localStorage voted cases
      const newVotes = [...votedCaseIds, caseId];
      setVotedCaseIds(newVotes);
      localStorage.setItem('juryduty_votes', JSON.stringify(newVotes));

      // End gavel animation
      setGavelBanging(false);
      
      triggerToast(type === 'guilty' ? 'VERDICT: GUILTY!' : 'VERDICT: INNOCENT!');
    }, 800); // Gavel bang duration
  };

  const startJudgeMode = () => {
    // Find first case user hasn't voted on
    const nextUnvoted = cases.find(c => !votedCaseIds.includes(c.id));
    if (nextUnvoted) {
      setSelectedCase(nextUnvoted);
      setIsJudgeMode(true);
      setView('courtroom');
      playRetroSuccessSound();
    } else {
      triggerToast('No cases left to judge!');
    }
  };

  const loadNextJudgeCase = () => {
    const nextUnvoted = cases.find(c => !votedCaseIds.includes(c.id) && c.id !== selectedCase?.id);
    if (nextUnvoted) {
      setSelectedCase(nextUnvoted);
    } else {
      setIsJudgeMode(false);
      setView('home');
      triggerToast('All cases judged! Order in court!');
    }
  };

  const openCaseDetails = (caseObj) => {
    setSelectedCase(caseObj);
    setIsJudgeMode(false);
    setView('courtroom');
    playRetroSuccessSound();
  };

  const handleSubmitCase = async (e) => {
    e.preventDefault();
    if (!formTitle || !formDesc || !formPunishment) {
      triggerToast('Fill in all fields, order!');
      return;
    }

    const newCase = {
      title: formTitle,
      description: formDesc,
      category: formCategory,
      guilty_votes: 0,
      not_guilty_votes: 0,
      punishment: formPunishment
    };

    try {
      const { data, error } = await supabase
        .from('cases')
        .insert([newCase])
        .select()
        .single();
      
      if (error) throw error;
      
      if (data) {
        setCases(prev => [data, ...prev]);
      }
    } catch (err) {
      console.error("Error submitting case to Supabase:", err);
      // Local fallback (saving to localStorage local cases)
      const fallbackCase = { ...newCase, id: Date.now() };
      const savedLocalCases = localStorage.getItem('juryduty_local_cases');
      const parsedLocalCases = savedLocalCases ? JSON.parse(savedLocalCases) : [];
      const newLocalCasesList = [fallbackCase, ...parsedLocalCases];
      localStorage.setItem('juryduty_local_cases', JSON.stringify(newLocalCasesList));
      setCases([fallbackCase, ...cases]);
    }
    
    // Clear inputs
    setFormTitle('');
    setFormDesc('');
    setFormPunishment('');
    
    setView('home');
    triggerToast('Case filed successfully!');
    playRetroSuccessSound();
  };

  // Filter and search logic
  const filteredCases = cases.filter(c => {
    const matchesCategory = filter === 'all' || 
      (filter === 'trending' ? true : c.category === filter);
    
    const matchesSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      c.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesCategory && matchesSearch;
  });

  // If sorting by trending, sort by total votes desc
  if (filter === 'trending') {
    filteredCases.sort((a, b) => (b.guilty_votes + b.not_guilty_votes) - (a.guilty_votes + a.not_guilty_votes));
  }

  // Calculate percentages helper
  const getPercentages = (c) => {
    const total = c.guilty_votes + c.not_guilty_votes;
    if (total === 0) return { guilty: 50, innocent: 50, total: 0 };
    return {
      guilty: Math.round((c.guilty_votes / total) * 100),
      innocent: Math.round((c.not_guilty_votes / total) * 100),
      total
    };
  };

  return (
    <div id="root">
      {/* Toast Alert */}
      {showToast && <div className="toast-verdict">{showToast}</div>}

      {/* Header Panel */}
      <header className="game-header">
        {view !== 'home' && (
          <button 
            className="back-header-btn" 
            onClick={() => { setView('home'); setIsJudgeMode(false); }}
          >
            &lt; BACK
          </button>
        )}
        <h1 className="game-title">JURY DUTY</h1>
        <p className="game-subtitle">8-Bit Petty Courtroom</p>
      </header>

      {/* VIEW: HOME / CASES FEED */}
      {view === 'home' && (
        <main className="cases-feed">
          {/* Main Action Banner */}
          <div className="pixel-box" style={{ background: 'var(--c-panel)', textAlign: 'center', padding: '24px 20px', borderColor: 'var(--c-magenta)', boxShadow: '6px 6px 0px var(--c-magenta)' }}>
            <p style={{ fontFamily: 'var(--font-game)', fontSize: '10px', color: 'var(--c-yellow)', marginBottom: '12px' }}>
              COURT IS IN SESSION
            </p>
            <button 
              className="gavel-btn guilty" 
              style={{ width: '100%', padding: '14px', marginBottom: '8px' }}
              onClick={startJudgeMode}
            >
              [ ENTER JUDGE MODE ]
            </button>
            <button 
              className="action-btn" 
              style={{ width: '100%' }}
              onClick={() => setView('submit')}
            >
              + SUBMIT YOUR DRAMA
            </button>
          </div>

          {/* Search Bar */}
          <input 
            type="text" 
            className="search-bar" 
            placeholder="Search cases..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          {/* Category Filter Tabs */}
          <div className="category-tabs">
            {['all', 'trending', 'relationships', 'roommates', 'dating', 'family', 'workplace'].map(cat => (
              <button 
                key={cat} 
                className={`tab-btn ${filter === cat ? 'active' : ''}`}
                onClick={() => setFilter(cat)}
              >
                {cat.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Case Feed List */}
          <div className="cases-list">
            {filteredCases.length === 0 ? (
              <div className="pixel-box" style={{ textAlign: 'center', opacity: 0.7 }}>
                No active disputes found. Order in court!
              </div>
            ) : (
              filteredCases.map(c => {
                const voted = votedCaseIds.includes(c.id);
                return (
                  <div 
                    key={c.id} 
                    className="pixel-box case-card"
                    onClick={() => openCaseDetails(c)}
                  >
                    <div className="case-card-header">
                      <span className="case-card-category">{c.category}</span>
                      <span className={`case-card-status ${voted ? 'solved' : 'unsolved'}`}>
                        {voted ? 'SOLVED' : 'ACTIVE'}
                      </span>
                    </div>
                    <h3 className="case-card-title">{c.title}</h3>
                    <p className="case-card-desc">
                      {c.description.substring(0, 85)}...
                    </p>
                    <div className="case-card-footer">
                      <span>👤 {c.guilty_votes + c.not_guilty_votes} jurors</span>
                      {voted && (
                        <span style={{ color: 'var(--c-gold)' }}>
                          ⚖️ {getPercentages(c).guilty}% GUILTY
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </main>
      )}

      {/* VIEW: COURTROOM & VOTING / RESULTS */}
      {view === 'courtroom' && selectedCase && (
        <main style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          
          {/* Visual 8-Bit Stage */}
          <div className="courtroom-stage">
            {/* Jury character (left) */}
            <div className="character-jury">
              <svg width="60" height="70" viewBox="0 0 60 70">
                {/* 3 pixelated jury faces */}
                {/* Face 1 */}
                <rect x="5" y="30" width="12" height="12" fill="#e0a080" stroke="#000" strokeWidth="2" />
                <rect x="7" y="34" width="2" height="2" fill="#000" />
                <rect x="13" y="34" width="2" height="2" fill="#000" />
                <rect x="5" y="42" width="12" height="15" fill="#305080" stroke="#000" strokeWidth="2" />
                
                {/* Face 2 (higher) */}
                <rect x="22" y="15" width="12" height="12" fill="#d08060" stroke="#000" strokeWidth="2" />
                <rect x="24" y="19" width="2" height="2" fill="#000" />
                <rect x="30" y="19" width="2" height="2" fill="#000" />
                <rect x="22" y="27" width="12" height="20" fill="#a03030" stroke="#000" strokeWidth="2" />

                {/* Face 3 */}
                <rect x="38" y="32" width="12" height="12" fill="#f0c0a0" stroke="#000" strokeWidth="2" />
                <rect x="40" y="36" width="2" height="2" fill="#000" />
                <rect x="46" y="36" width="2" height="2" fill="#000" />
                <rect x="38" y="44" width="12" height="13" fill="#207040" stroke="#000" strokeWidth="2" />
              </svg>
            </div>

            {/* Judge at Bench (center) */}
            <div className="character-judge">
              {/* Judge character */}
              <svg width="50" height="50" viewBox="0 0 50 50">
                {/* Curly Wig */}
                <rect x="12" y="4" width="26" height="18" fill="#e0e0e0" rx="3" stroke="#000" strokeWidth="2" />
                <circle cx="12" cy="14" r="5" fill="#e0e0e0" stroke="#000" strokeWidth="2" />
                <circle cx="38" cy="14" r="5" fill="#e0e0e0" stroke="#000" strokeWidth="2" />
                {/* Face */}
                <rect x="16" y="10" width="18" height="14" fill="#fbc3a6" />
                <rect x="19" y="14" width="2" height="2" fill="#000" />
                <rect x="29" y="14" width="2" height="2" fill="#000" />
                {/* Red Collar / Glasses if any */}
                <rect x="21" y="22" width="8" height="2" fill="#a01010" />
                {/* Black Robe body */}
                <rect x="10" y="24" width="30" height="26" fill="#111" stroke="#000" strokeWidth="2" />
              </svg>
            </div>
            
            {/* The Bench wrapper overlay */}
            <div className="court-bench">
              {/* Hammer / Gavel resting or animated */}
              <svg 
                className={`gavel-svg ${gavelBanging ? 'bang-animation' : ''}`}
                width="40" 
                height="40" 
                viewBox="0 0 40 40"
                style={{ position: 'absolute', right: '-15px', top: '-15px' }}
              >
                {/* Gavel head */}
                <rect x="5" y="10" width="16" height="8" fill="#5c2c16" stroke="#000" strokeWidth="2" />
                <rect x="3" y="9" width="3" height="10" fill="#a86038" stroke="#000" strokeWidth="1" />
                <rect x="20" y="9" width="3" height="10" fill="#a86038" stroke="#000" strokeWidth="1" />
                {/* Gavel handle */}
                <rect x="11" y="18" width="4" height="16" fill="#a86038" stroke="#000" strokeWidth="2" transform="rotate(-30 13 18)" />
              </svg>
            </div>

            {/* Defendant character (right) */}
            <div className="character-defendant" style={{ position: 'relative' }}>
              <svg width="50" height="70" viewBox="0 0 50 70">
                {/* Sweating drops if not voted */}
                {!votedCaseIds.includes(selectedCase.id) && (
                  <>
                    <rect className="sweat-drop" x="12" y="18" width="3" height="5" fill="#00f0ff" style={{ animationDelay: '0s' }} />
                    <rect className="sweat-drop" x="38" y="22" width="3" height="5" fill="#00f0ff" style={{ animationDelay: '0.4s' }} />
                  </>
                )}
                {/* Hair */}
                <rect x="15" y="8" width="22" height="12" fill="#503020" stroke="#000" strokeWidth="2" />
                {/* Face */}
                <rect x="17" y="16" width="18" height="16" fill="#fbc3a6" stroke="#000" strokeWidth="2" />
                {/* Eyes showing concern/nervous */}
                <rect x="20" y="21" width="3" height="2" fill="#000" />
                <rect x="28" y="21" width="3" height="2" fill="#000" />
                <rect x="23" y="27" width="5" height="2" fill="#c03030" /> {/* Nervous red mouth */}
                {/* Striped Prisoner Shirt / Nervous Shirt */}
                <rect x="10" y="32" width="32" height="38" fill="#e0e0e0" stroke="#000" strokeWidth="2" />
                {/* Stripes */}
                <rect x="16" y="32" width="4" height="38" fill="#111" />
                <rect x="24" y="32" width="4" height="38" fill="#111" />
                <rect x="32" y="32" width="4" height="38" fill="#111" />
              </svg>
            </div>
          </div>

          {/* Scrolling folder container */}
          <div className="case-story-scroller">
            {/* Has the user already voted on this case? */}
            {!votedCaseIds.includes(selectedCase.id) ? (
              /* ACTIVE CASE STATE */
              <div className="pixel-box light case-folder">
                <div className="case-folder-header">
                  CASE FILE: {selectedCase.category.toUpperCase()}
                </div>
                <h2 className="case-folder-title">{selectedCase.title}</h2>
                <p className="case-folder-desc" style={{ color: 'var(--c-text-dark)' }}>
                  "{selectedCase.description}"
                </p>
              </div>
            ) : (
              /* SOLVED CASE STATE (VERDICT CARD) */
              <div className="pixel-box light verdict-sheet">
                <div className="verdict-title">THE VERDICT</div>
                
                {/* Percentage distribution visualizer */}
                <div className="verdict-percentage-bar">
                  <div 
                    className="verdict-fill-guilty" 
                    style={{ width: `${getPercentages(selectedCase).guilty}%` }}
                  ></div>
                  <div className="verdict-percentage-label">
                    <span>{getPercentages(selectedCase).guilty}% GUILTY</span>
                    <span>{getPercentages(selectedCase).innocent}% INNOCENT</span>
                  </div>
                </div>

                <div className="verdict-stats-row">
                  <span>TOTAL JURORS: {getPercentages(selectedCase).total}</span>
                  <span style={{ color: getPercentages(selectedCase).guilty >= 50 ? 'var(--c-gavel-red)' : 'var(--c-gavel-green)' }}>
                    STATUS: {getPercentages(selectedCase).guilty >= 50 ? 'GUILTY' : 'INNOCENT'}
                  </span>
                </div>

                {/* AI Punishment box */}
                <div className="pixel-box" style={{ background: 'var(--c-panel)', border: 'var(--border-width) solid var(--c-border)', margin: '20px 0 10px 0', padding: '16px', boxShadow: 'none' }}>
                  <p style={{ fontFamily: 'var(--font-game)', fontSize: '8px', color: 'var(--c-yellow)', marginBottom: '10px' }}>
                    ⚖️ MANDATORY PUNISHMENT:
                  </p>
                  <p className="punishment-text" style={{ color: 'var(--c-text-light)' }}>
                    "{selectedCase.punishment}"
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Actions Panel */}
          <div className="court-controls">
            {!votedCaseIds.includes(selectedCase.id) ? (
              /* Voting buttons active */
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  className="gavel-btn not-guilty" 
                  style={{ flex: 1 }}
                  onClick={() => handleVote(selectedCase.id, 'not_guilty')}
                >
                  [ INNOCENT ]
                </button>
                <button 
                  className="gavel-btn guilty" 
                  style={{ flex: 1 }}
                  onClick={() => handleVote(selectedCase.id, 'guilty')}
                >
                  [ GUILTY ]
                </button>
              </div>
            ) : (
              /* Share / Next logic when solved */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  className="gavel-btn not-guilty"
                  onClick={() => {
                    const text = `I judged "${selectedCase.title}" on JuryDuty! ${getPercentages(selectedCase).guilty}% voted GUILTY. What's your verdict?`;
                    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);
                  }}
                >
                  SHARE VERDICT CARD
                </button>
                
                <div className="menu-controls">
                  <button 
                    className="action-btn"
                    onClick={() => { setView('home'); setIsJudgeMode(false); }}
                  >
                    GO TO FEED
                  </button>
                  {isJudgeMode && (
                    <button 
                      className="action-btn primary"
                      onClick={loadNextJudgeCase}
                    >
                      NEXT CASE &gt;
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* VIEW: SUBMIT NEW DRAMA FORM */}
      {view === 'submit' && (
        <main className="cases-feed">
          <div className="pixel-box" style={{ background: 'var(--c-panel)', borderColor: 'var(--c-yellow)', boxShadow: '6px 6px 0px var(--c-yellow)' }}>
            <h2 style={{ fontFamily: 'var(--font-game)', fontSize: '12px', color: 'var(--c-yellow)', marginBottom: '16px', textAlign: 'center' }}>
              FILE A COMPLAINT
            </h2>

            <form onSubmit={handleSubmitCase}>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select 
                  className="form-select" 
                  value={formCategory} 
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  <option value="relationships">Relationships</option>
                  <option value="roommates">Roommates</option>
                  <option value="dating">Dating</option>
                  <option value="family">Family</option>
                  <option value="workplace">Workplace</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Case Title</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. The Eaten Pizza" 
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  maxLength={40}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">What Happened? (The Story)</label>
                <textarea 
                  className="form-textarea" 
                  placeholder="Tell your story. Keep it short. End with: Am I the jerk?" 
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  maxLength={250}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Fair Punishment (If found guilty)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Buy me a new pizza" 
                  value={formPunishment}
                  onChange={(e) => setFormPunishment(e.target.value)}
                  maxLength={60}
                  required
                />
              </div>

              <button type="submit" className="gavel-btn guilty" style={{ width: '100%', marginTop: '16px' }}>
                SUBMIT TO THE JURY
              </button>
            </form>
          </div>
        </main>
      )}

      {/* Footer / Copyright */}
      <footer style={{ 
        textAlign: 'center', 
        padding: '12px', 
        fontSize: '14px', 
        opacity: 0.5, 
        borderTop: '2px dashed rgba(255,255,255,0.1)',
        marginTop: 'auto'
      }}>
        © 2026 JURYDUTY INC. BYPASS THE LAW.
      </footer>
    </div>
  );
}

export default App;
