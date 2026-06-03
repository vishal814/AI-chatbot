'use client';

import React, { useState, useEffect, useRef } from 'react';

interface CitationNode {
  id: string;
  postId: string;
  platform: 'linkedin' | 'twitter' | 'instagram';
  content: string;
  timestamp: string;
  url?: string;
  media?: string[];
  author: string;
  hash: string;
}

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  citations?: CitationNode[];
  loading?: boolean;
}

interface DBStats {
  totalChunks: number;
  totalUniquePosts: number;
  platformStats: Record<string, { chunks: number; posts: number }>;
}

interface PlatformProfile {
  name: string;
  username: string;
  bio?: string;
  avatar?: string;
}

export default function Home() {
  // State variables
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: "Hello! Welcome to your Social Knowledge Base. Get started by uploading your platform data exports (LinkedIn CSVs, Twitter JSON/JS, or Instagram JSON/HTML). Once ingested, you can ask me anything about the content!",
    },
  ]);
  const [input, setInput] = useState('');
  const [dbStats, setDbStats] = useState<DBStats>({
    totalChunks: 0,
    totalUniquePosts: 0,
    platformStats: {
      linkedin: { chunks: 0, posts: 0 },
      twitter: { chunks: 0, posts: 0 },
      instagram: { chunks: 0, posts: 0 },
    },
  });
  const [profiles, setProfiles] = useState<Record<string, PlatformProfile>>({});
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<CitationNode | null>(null);

  // File drag & drop reference
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load DB status on mount
  useEffect(() => {
    fetchStatus();
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.stats) setDbStats(data.stats);
      if (data.profiles) setProfiles(data.profiles);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const handleWipeDatabase = async () => {
    if (!confirm('Are you sure you want to delete all ingested content? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/status', { method: 'DELETE' });
      const data = await res.json();
      if (data.stats) setDbStats(data.stats);
      setProfiles({});
      setMessages([
        {
          id: 'cleared',
          sender: 'bot',
          text: 'Database successfully cleared. You can now upload new data exports to start fresh!',
        },
      ]);
    } catch (err) {
      alert('Failed to clear database: ' + (err as Error).message);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadFeedback('Reading files and preparing zip/CSV data...');

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      setUploadFeedback('Sending files to ingestion engine... (Parsing social media content)');
      
      const res = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ingestion failed.');
      }

      setUploadFeedback(
        `Successfully ingested ${data.platform.toUpperCase()} export!\n` +
        `- Parsed posts: ${data.totalParsed}\n` +
        `- New indexed chunks: ${data.chunksCreated || 0}\n` +
        `- Duplicates skipped: ${data.duplicatesSkipped}`
      );

      // Refresh DB stats and profiles
      fetchStatus();
    } catch (err) {
      setUploadFeedback(`Error: ${(err as Error).message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const queryText = textToSend || input;
    if (!queryText.trim()) return;

    // Add user message
    const userMsgId = `user-${Date.now()}`;
    const botMsgId = `bot-${Date.now()}`;
    
    setMessages(prev => [
      ...prev,
      { id: userMsgId, sender: 'user', text: queryText },
      { id: botMsgId, sender: 'bot', text: 'Analyzing database and generating grounded response...', loading: true },
    ]);

    if (!textToSend) setInput('');
    setIsSearching(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: queryText }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Query failed.');
      }

      if (!res.body) {
        throw new Error('Response stream not readable.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let citations: CitationNode[] = [];
      let currentText = '';
      let buffer = '';
      let parsedCitations = false;

      // Transition loading state to empty streaming text
      setMessages(prev =>
        prev.map(m =>
          m.id === botMsgId
            ? {
                id: botMsgId,
                sender: 'bot',
                text: '',
                citations: [],
                loading: false,
              }
            : m
        )
      );

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunkStr = decoder.decode(value, { stream: !done });
          
          if (!parsedCitations) {
            buffer += chunkStr;
            const newlineIdx = buffer.indexOf('\n');
            if (newlineIdx !== -1) {
              const firstLine = buffer.slice(0, newlineIdx);
              const remainder = buffer.slice(newlineIdx + 1);
              
              if (firstLine.startsWith('__CITATIONS__:')) {
                const jsonStr = firstLine.replace('__CITATIONS__:', '');
                try {
                  citations = JSON.parse(jsonStr);
                } catch (e) {
                  console.error('Failed to parse citations:', e);
                }
              }
              
              parsedCitations = true;
              currentText = remainder;
              
              if (currentText) {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === botMsgId
                      ? {
                          ...m,
                          text: currentText,
                          citations: citations,
                        }
                      : m
                  )
                );
              }
            }
          } else {
            currentText += chunkStr;
            setMessages(prev =>
              prev.map(m =>
                m.id === botMsgId
                  ? {
                      ...m,
                      text: currentText,
                      citations: citations,
                    }
                  : m
              )
            );
          }
        }
      }
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === botMsgId
            ? {
                id: botMsgId,
                sender: 'bot',
                text: `Error: ${(err as Error).message}. Check your API key or data ingestion.`,
                citations: [],
                loading: false,
              }
            : m
        )
      );
    } finally {
      setIsSearching(false);
    }
  };

  // Convert inline text citations like [1] or [1, 2] to interactive components
  const renderMessageText = (text: string, citations?: CitationNode[]) => {
    if (!citations || citations.length === 0) return text;

    // Matches bracketed numbers e.g. [1] or [1, 2]
    const regex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const matchIndex = match.index;
      // Add text before citation
      if (matchIndex > lastIndex) {
        parts.push(text.substring(lastIndex, matchIndex));
      }

      // Parse individual indices (1-based from model citation markers)
      const indicesStr = match[1];
      const indices = indicesStr.split(',').map(s => parseInt(s.trim(), 10));

      indices.forEach((citationIdx, subIdx) => {
        const node = citations[citationIdx - 1];
        if (node) {
          parts.push(
            <span
              key={`${matchIndex}-${citationIdx}-${subIdx}`}
              className="citation-link"
              title={`Source ${citationIdx}: Click to view context`}
              onClick={() => setActiveCitation(node)}
            >
              {citationIdx}
            </span>
          );
        } else {
          // If out of range index, render as plain bracket text
          parts.push(`[${citationIdx}]`);
        }
        if (subIdx < indices.length - 1) {
          parts.push(',');
        }
      });

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts;
  };

  const getPlatformBadgeClass = (platform: string) => {
    switch (platform) {
      case 'linkedin': return 'badge badge-linkedin';
      case 'twitter': return 'badge badge-twitter';
      case 'instagram': return 'badge badge-instagram';
      default: return 'badge';
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'linkedin': return '💼';
      case 'twitter': return '🐦';
      case 'instagram': return '📸';
      default: return '📄';
    }
  };

  const activeProfilesList = Object.entries(profiles);

  return (
    <div className="app-container">
      {/* 1. Sidebar Panel */}
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">S</div>
          <span className="logo-text">SocialMind AI</span>
        </div>

        {/* Database Status Section */}
        <h2 className="section-title">Knowledge Base</h2>
        
        {activeProfilesList.length > 0 && (
          <div className="active-profile-details">
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Identified Profiles
            </span>
            {activeProfilesList.map(([platform, prof]) => (
              <div key={platform} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', margin: '4px 0' }}>
                <span>{getPlatformIcon(platform)}</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{prof.name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@{prof.username}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="stats-container">
          <div className="stat-item">
            <div className="stat-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa' }}>📚</div>
            <div className="stat-info">
              <span className="stat-label">Vector Chunks</span>
              <span className="stat-value">{dbStats.totalChunks}</span>
            </div>
          </div>

          <div className="stat-item">
            <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}>📝</div>
            <div className="stat-info">
              <span className="stat-label">Unique Posts</span>
              <span className="stat-value">{dbStats.totalUniquePosts}</span>
            </div>
          </div>

          <div className="stat-item">
            <div className="stat-icon" style={{ background: 'rgba(10, 102, 194, 0.15)', color: '#70b5f9' }}>💼</div>
            <div className="stat-info">
              <span className="stat-label">LinkedIn Content</span>
              <span className="stat-value">{dbStats.platformStats.linkedin.posts} posts</span>
            </div>
          </div>

          <div className="stat-item">
            <div className="stat-icon" style={{ background: 'rgba(29, 161, 242, 0.15)', color: '#7cd4fd' }}>🐦</div>
            <div className="stat-info">
              <span className="stat-label">Twitter/X Content</span>
              <span className="stat-value">{dbStats.platformStats.twitter.posts} tweets</span>
            </div>
          </div>

          <div className="stat-item">
            <div className="stat-icon" style={{ background: 'rgba(225, 48, 108, 0.15)', color: '#f472b6' }}>📸</div>
            <div className="stat-info">
              <span className="stat-label">Instagram Content</span>
              <span className="stat-value">{dbStats.platformStats.instagram.posts} posts</span>
            </div>
          </div>
        </div>

        {/* Database Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
          <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>
            📥 Ingest Data Export
          </button>
          {dbStats.totalChunks > 0 && (
            <button className="btn btn-danger" onClick={handleWipeDatabase}>
              🗑️ Reset Database
            </button>
          )}
        </div>

      </aside>

      {/* 2. Main content view */}
      <main className="main-content">
        {/* Top Header */}
        <header className="top-nav">
          <div className="profile-card">
            <div className="profile-avatar">S</div>
            <div>
              <h1 className="profile-name">Persona RAG Assistant</h1>
              <p className="profile-bio">
                {dbStats.totalChunks > 0
                  ? `Answering queries based on ${dbStats.totalUniquePosts} ingested records`
                  : 'Ready to ingest export files'}
              </p>
            </div>
          </div>
        </header>

        {/* Chat Pane */}
        <div className="chat-pane glass-panel">
          <div className="messages-list">
            {messages.map(msg => (
              <div key={msg.id} className={`message-row ${msg.sender}`}>
                <div className="message-bubble">
                  {msg.loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="animate-pulse" style={{ fontSize: '20px' }}>⚡</span>
                      <span>{msg.text}</span>
                    </div>
                  ) : (
                    <>
                      <div>{renderMessageText(msg.text, msg.citations)}</div>
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="citations-tray">
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '100%', fontWeight: 'bold', marginTop: '6px' }}>
                            Retrieved Sources:
                          </span>
                          {msg.citations.map((node, index) => (
                            <div
                              key={node.id}
                              className="citation-card"
                              onClick={() => setActiveCitation(node)}
                            >
                              <div className="citation-card-header">
                                <span className={getPlatformBadgeClass(node.platform)}>
                                  {node.platform}
                                </span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                                  Source [{index + 1}]
                                </span>
                              </div>
                              <div className="citation-card-body">
                                {node.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Suggested Queries */}
        {dbStats.totalChunks > 0 && !isSearching && (
          <div className="suggestions-panel">
            <span style={{ fontSize: '12px', alignSelf: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Try asking:</span>
            <button className="suggestion-chip" onClick={() => handleSendMessage('What does this person think about remote work?')}>
              💭 Views on remote work
            </button>
            <button className="suggestion-chip" onClick={() => handleSendMessage('What are the core topics this person posts about?')}>
              📊 Main posting topics
            </button>
            <button className="suggestion-chip" onClick={() => handleSendMessage('Summarize the professional background or timeline.')}>
              💼 Professional summary
            </button>
          </div>
        )}

        {/* Input Bar */}
        <div className="input-area">
          <input
            type="text"
            className="input-field"
            placeholder={dbStats.totalChunks > 0 ? "Ask anything about this persona..." : "Please ingest data to start chatting."}
            disabled={dbStats.totalChunks === 0 || isSearching}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
          />
          <button
            className="send-btn"
            onClick={() => handleSendMessage()}
            disabled={dbStats.totalChunks === 0 || isSearching || !input.trim()}
          >
            ➔
          </button>
        </div>
      </main>

      {/* 3. Upload Modal */}
      {showUploadModal && (
        <div className="upload-modal-overlay">
          <div className="upload-modal glass-panel animate-fade-in">
            <div className="modal-header">
              <h3 className="modal-title">Ingest Platform Export</h3>
              <button className="close-btn" onClick={() => { setShowUploadModal(false); setUploadFeedback(null); }}>
                ✕
              </button>
            </div>
            
            <div
              className="dropzone"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="dropzone-icon">📁</div>
              <div className="dropzone-text">
                <span>Click to select files</span> or drag them here
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Supports .zip exports or individual .csv, .json, .js, .html files
              </span>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                multiple
                onChange={handleFileUpload}
              />
            </div>

            {/* Ingestion Feedback Area */}
            {uploadFeedback && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  background: 'rgba(0,0,0,0.2)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '150px',
                  overflowY: 'auto',
                  fontFamily: 'var(--font-mono)',
                  color: isUploading ? '#fbbf24' : '#34d399'
                }}
              >
                {uploadFeedback}
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                className="btn btn-secondary"
                disabled={isUploading}
                onClick={() => { setShowUploadModal(false); setUploadFeedback(null); }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Active Citation Detail Drawer / Modal */}
      {activeCitation && (
        <div className="upload-modal-overlay">
          <div className="upload-modal glass-panel animate-fade-in" style={{ width: '600px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={getPlatformBadgeClass(activeCitation.platform)}>
                  {activeCitation.platform}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {new Date(activeCitation.timestamp).toLocaleString()}
                </span>
              </div>
              <button className="close-btn" onClick={() => setActiveCitation(null)}>
                ✕
              </button>
            </div>

            <div className="citation-modal-content">
              {activeCitation.content}
            </div>

            {activeCitation.url && (
              <div style={{ marginTop: '12px', fontSize: '13px' }}>
                <a
                  href={activeCitation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#60a5fa', textDecoration: 'underline' }}
                >
                  View Original Post ➔
                </a>
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setActiveCitation(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
