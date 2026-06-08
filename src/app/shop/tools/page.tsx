"use client";

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../../page.module.css';

type Tool = {
    id: number;
    name: string;
    safetyGuide: string | null;
    _count?: { toolStatuses: number };
};

type Certification = {
    userId: number;
    toolId: number;
    level: "BASIC" | "DOF" | "CERTIFIED" | "INSTRUCTOR" | "MAY_CERTIFY_OTHERS";
    user?: { id: number; name: string | null; email: string };
    tool?: { id: number; name: string };
};

type Member = { id: number; name: string | null; email: string };

type Tab = 'tools' | 'person' | 'all';

const LEVEL_RANKS: Record<string, number> = {
    NONE: 0, BASIC: 1, CERTIFIED: 2, DOF: 3, INSTRUCTOR: 4, MAY_CERTIFY_OTHERS: 5,
};

const LEVEL_LABELS: Record<string, string> = {
    BASIC: 'Basic', CERTIFIED: 'Certified', DOF: 'DoF', INSTRUCTOR: 'Instructor', MAY_CERTIFY_OTHERS: 'Certifier',
};

function levelBadge(level: string) {
    const colors: Record<string, { bg: string; color: string }> = {
        BASIC: { bg: '#ef4444', color: '#fff' },
        CERTIFIED: { bg: '#22c55e', color: '#000' },
        DOF: { bg: '#eab308', color: '#000' },
        INSTRUCTOR: { bg: '#3b82f6', color: '#fff' },
        MAY_CERTIFY_OTHERS: { bg: '#a855f7', color: '#fff' },
    };
    const c = colors[level] || { bg: 'transparent', color: 'gray' };
    return (
        <span style={{
            background: c.bg, color: c.color,
            padding: '0.25rem 0.55rem', borderRadius: '10px',
            fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
        }}>
            {LEVEL_LABELS[level] ?? level}
        </span>
    );
}

function GrantForm({
    tools, members, prefillToolId, prefillMemberId, onGranted, saving, setSaving,
}: {
    tools: Tool[];
    members: Member[];
    prefillToolId?: number;
    prefillMemberId?: number;
    onGranted: (msg: string) => void;
    saving: boolean;
    setSaving: (v: boolean) => void;
}) {
    const [toolId, setToolId] = useState(prefillToolId?.toString() ?? "");
    const [memberId, setMemberId] = useState(prefillMemberId?.toString() ?? "");
    const [level, setLevel] = useState("CERTIFIED");
    const [confirm, setConfirm] = useState<null | { toolName: string; userName: string; oldLevel: string; newLevel: string; payload: object }>(null);

    const selectedTool = tools.find(t => t.id === parseInt(toolId));
    const selectedMember = members.find(m => m.id === parseInt(memberId));

    const initiate = (e: React.FormEvent) => {
        e.preventDefault();
        if (!toolId || !memberId || !level) return;
        setConfirm({
            toolName: selectedTool?.name ?? '?',
            userName: selectedMember?.name ?? selectedMember?.email ?? '?',
            oldLevel: 'NONE',
            newLevel: level,
            payload: { toolId: parseInt(toolId), participantId: parseInt(memberId), level },
        });
    };

    const confirm_ = async () => {
        if (!confirm) return;
        setSaving(true);
        try {
            const res = await fetch('/api/shop/certifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(confirm.payload),
            });
            const data = await res.json();
            if (res.ok) {
                onGranted(`Certification updated for ${confirm.userName} on ${confirm.toolName}.`);
                setMemberId(prefillMemberId?.toString() ?? "");
                setToolId(prefillToolId?.toString() ?? "");
            } else {
                onGranted(data.error ?? 'Failed.');
            }
        } finally {
            setSaving(false);
            setConfirm(null);
        }
    };

    return (
        <>
            <form onSubmit={initiate} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {!prefillToolId && (
                    <div style={{ flex: '1 1 180px' }}>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'gray' }}>Tool</label>
                        <select className="glass-input" value={toolId} onChange={e => setToolId(e.target.value)} required style={{ width: '100%', padding: '0.6rem' }}>
                            <option value="">-- Tool --</option>
                            {tools.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </div>
                )}
                {!prefillMemberId && (
                    <div style={{ flex: '1 1 180px' }}>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'gray' }}>Member</label>
                        <select className="glass-input" value={memberId} onChange={e => setMemberId(e.target.value)} required style={{ width: '100%', padding: '0.6rem' }}>
                            <option value="">-- Member --</option>
                            {members.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email}</option>)}
                        </select>
                    </div>
                )}
                <div style={{ width: '130px' }}>
                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'gray' }}>Level</label>
                    <select className="glass-input" value={level} onChange={e => setLevel(e.target.value)} style={{ width: '100%', padding: '0.6rem' }}>
                        <option value="BASIC">Basic</option>
                        <option value="CERTIFIED">Certified</option>
                        <option value="DOF">DoF</option>
                        <option value="INSTRUCTOR">Instructor</option>
                        <option value="MAY_CERTIFY_OTHERS">Certifier</option>
                    </select>
                </div>
                <button type="submit" className="glass-button" disabled={saving} style={{ padding: '0.6rem 1.2rem', background: 'rgba(34,197,94,0.2)', borderColor: 'rgba(34,197,94,0.4)' }}>
                    Grant
                </button>
            </form>

            {confirm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="glass-container" style={{ maxWidth: '380px', width: '90%', padding: '2rem', textAlign: 'center' }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>Confirm Certification</h3>
                        <p style={{ marginBottom: '1.5rem' }}>
                            Grant <strong>{confirm.newLevel}</strong> on <strong>{confirm.toolName}</strong> to <strong>{confirm.userName}</strong>?
                        </p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="glass-button" style={{ flex: 1 }} onClick={() => setConfirm(null)}>Cancel</button>
                            <button className="glass-button" style={{ flex: 1, background: 'rgba(34,197,94,0.2)', borderColor: 'rgba(34,197,94,0.4)' }} onClick={confirm_} disabled={saving}>
                                {saving ? 'Saving...' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ---- Tools tab ----

function ToolsTab({ tools, members, isAdmin, isCertifier, onToolsChange }: {
    tools: Tool[];
    members: Member[];
    isAdmin: boolean;
    isCertifier: boolean;
    onToolsChange: () => void;
}) {
    const [expanded, setExpanded] = useState<number | null>(null);
    const [certs, setCerts] = useState<Certification[]>([]);
    const [loadingCerts, setLoadingCerts] = useState(false);
    const [editingGuide, setEditingGuide] = useState<{ id: number; value: string } | null>(null);
    const [savingGuide, setSavingGuide] = useState(false);
    const [msg, setMsg] = useState("");
    const [grantMsg, setGrantMsg] = useState("");
    const [grantSaving, setGrantSaving] = useState(false);
    const [search, setSearch] = useState("");

    const toggle = async (toolId: number) => {
        if (expanded === toolId) { setExpanded(null); setCerts([]); return; }
        setExpanded(toolId);
        setLoadingCerts(true);
        try {
            const res = await fetch(`/api/shop/certifications?toolId=${toolId}`);
            if (res.ok) setCerts(await res.json());
        } finally {
            setLoadingCerts(false);
        }
    };

    const saveGuide = async () => {
        if (!editingGuide) return;
        setSavingGuide(true);
        try {
            const res = await fetch(`/api/shop/tools/${editingGuide.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ safetyGuide: editingGuide.value }),
            });
            if (res.ok) {
                setMsg("Safety guide updated.");
                setEditingGuide(null);
                onToolsChange();
                if (expanded === editingGuide.id) {
                    const toolRes = await fetch(`/api/shop/certifications?toolId=${editingGuide.id}`);
                    if (toolRes.ok) setCerts(await toolRes.json());
                }
            } else {
                setMsg("Failed to update.");
            }
        } finally {
            setSavingGuide(false);
        }
    };

    const filtered = tools.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div>
            {msg && <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: '8px', color: '#38bdf8' }}>{msg}</div>}

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                    type="text"
                    className="glass-input"
                    placeholder="Search tools..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ flex: '1 1 220px', padding: '0.6rem 0.9rem' }}
                />
                {isAdmin && (
                    <Link href="/shop/tools/new" className="glass-button" style={{ textDecoration: 'none', padding: '0.6rem 1.2rem', background: 'rgba(56,189,248,0.2)', borderColor: 'rgba(56,189,248,0.4)', whiteSpace: 'nowrap' }}>
                        + New Tool
                    </Link>
                )}
            </div>

            {filtered.length === 0 && <p style={{ color: 'gray' }}>No tools match.</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {filtered.map(tool => {
                    const isOpen = expanded === tool.id;
                    return (
                        <div key={tool.id} style={{ borderRadius: '10px', border: '1px solid', borderColor: isOpen ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                            {/* Row */}
                            <div
                                style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1rem', background: isOpen ? 'rgba(56,189,248,0.07)' : 'rgba(255,255,255,0.03)', cursor: 'pointer' }}
                                onClick={() => toggle(tool.id)}
                            >
                                <span style={{ flex: 1, fontWeight: 600, color: isOpen ? '#38bdf8' : 'var(--color-text)' }}>{tool.name}</span>

                                <span style={{ fontSize: '0.8rem', color: 'gray', whiteSpace: 'nowrap' }}>
                                    {tool._count?.toolStatuses ?? '?'} certified
                                </span>

                                {tool.safetyGuide ? (
                                    <a href={tool.safetyGuide} target="_blank" rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        style={{ fontSize: '0.8rem', color: '#38bdf8', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                                        Safety Guide ↗
                                    </a>
                                ) : (
                                    <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.25)', whiteSpace: 'nowrap' }}>No guide</span>
                                )}

                                {isAdmin && (
                                    <button
                                        className="glass-button"
                                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', background: 'transparent', borderColor: 'rgba(255,255,255,0.2)' }}
                                        onClick={e => { e.stopPropagation(); setEditingGuide({ id: tool.id, value: tool.safetyGuide ?? '' }); setMsg(""); }}
                                    >
                                        Edit guide
                                    </button>
                                )}

                                <span style={{ color: 'gray', fontSize: '0.9rem' }}>{isOpen ? '▲' : '▼'}</span>
                            </div>

                            {/* Drilldown */}
                            {isOpen && (
                                <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.15)' }}>
                                    {loadingCerts ? <p style={{ color: 'gray' }}>Loading...</p> : (
                                        <>
                                            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Certified members</h4>
                                            {certs.length === 0 ? (
                                                <p style={{ color: 'gray', fontSize: '0.9rem' }}>No certifications yet.</p>
                                            ) : (
                                                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                                    {certs.map(c => (
                                                        <li key={`${c.userId}-${c.toolId}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                                                            <span style={{ fontSize: '0.9rem' }}>
                                                                {c.user?.name ?? 'Unnamed'}{' '}
                                                                <span style={{ color: 'gray', fontSize: '0.8rem' }}>({c.user?.email})</span>
                                                            </span>
                                                            {levelBadge(c.level)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}

                                            {isCertifier && (
                                                <>
                                                    {grantMsg && <p style={{ fontSize: '0.85rem', color: '#38bdf8', marginBottom: '0.75rem' }}>{grantMsg}</p>}
                                                    <GrantForm
                                                        tools={tools} members={members}
                                                        prefillToolId={tool.id}
                                                        onGranted={m => { setGrantMsg(m); toggle(tool.id).then(() => toggle(tool.id)); }}
                                                        saving={grantSaving} setSaving={setGrantSaving}
                                                    />
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Edit guide modal */}
            {editingGuide && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="glass-container" style={{ maxWidth: '480px', width: '90%', padding: '2rem' }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>Edit Safety Guide URL</h3>
                        <input
                            type="url"
                            className="glass-input"
                            placeholder="https://..."
                            value={editingGuide.value}
                            onChange={e => setEditingGuide({ ...editingGuide, value: e.target.value })}
                            style={{ width: '100%', padding: '0.75rem', marginBottom: '1rem' }}
                        />
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="glass-button" style={{ flex: 1 }} onClick={() => setEditingGuide(null)}>Cancel</button>
                            <button className="glass-button" style={{ flex: 1, background: 'rgba(34,197,94,0.2)', borderColor: 'rgba(34,197,94,0.4)' }} onClick={saveGuide} disabled={savingGuide}>
                                {savingGuide ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ---- By Person tab ----

function PersonTab({ members, tools, isCertifier }: { members: Member[]; tools: Tool[]; isCertifier: boolean }) {
    const [expanded, setExpanded] = useState<number | null>(null);
    const [certs, setCerts] = useState<Certification[]>([]);
    const [loadingCerts, setLoadingCerts] = useState(false);
    const [search, setSearch] = useState("");
    const [grantMsg, setGrantMsg] = useState("");
    const [grantSaving, setGrantSaving] = useState(false);

    const toggle = async (memberId: number) => {
        if (expanded === memberId) { setExpanded(null); setCerts([]); return; }
        setExpanded(memberId);
        setLoadingCerts(true);
        try {
            const res = await fetch(`/api/shop/certifications?participantId=${memberId}`);
            if (res.ok) setCerts(await res.json());
        } finally {
            setLoadingCerts(false);
        }
    };

    const filtered = members.filter(m =>
        (m.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        m.email.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div>
            <input
                type="text"
                className="glass-input"
                placeholder="Search members..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', padding: '0.6rem 0.9rem', marginBottom: '1.25rem' }}
            />

            {filtered.length === 0 && <p style={{ color: 'gray' }}>No members match.</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {filtered.map(member => {
                    const isOpen = expanded === member.id;
                    return (
                        <div key={member.id} style={{ borderRadius: '10px', border: '1px solid', borderColor: isOpen ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                            <div
                                style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1rem', background: isOpen ? 'rgba(56,189,248,0.07)' : 'rgba(255,255,255,0.03)', cursor: 'pointer' }}
                                onClick={() => toggle(member.id)}
                            >
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 600, color: isOpen ? '#38bdf8' : 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {member.name ?? 'Unnamed'}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'gray', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.email}</div>
                                </div>
                                <span style={{ color: 'gray', fontSize: '0.9rem' }}>{isOpen ? '▲' : '▼'}</span>
                            </div>

                            {isOpen && (
                                <div style={{ padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.15)' }}>
                                    {loadingCerts ? <p style={{ color: 'gray' }}>Loading...</p> : (
                                        <>
                                            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Tool certifications</h4>
                                            {certs.length === 0 ? (
                                                <p style={{ color: 'gray', fontSize: '0.9rem' }}>No certifications.</p>
                                            ) : (
                                                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                                    {certs.map(c => (
                                                        <li key={`${c.userId}-${c.toolId}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                                                            <span style={{ fontSize: '0.9rem' }}>{c.tool?.name ?? 'Unknown Tool'}</span>
                                                            {levelBadge(c.level)}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}

                                            {isCertifier && (
                                                <>
                                                    {grantMsg && <p style={{ fontSize: '0.85rem', color: '#38bdf8', marginBottom: '0.75rem' }}>{grantMsg}</p>}
                                                    <GrantForm
                                                        tools={tools} members={members}
                                                        prefillMemberId={member.id}
                                                        onGranted={m => { setGrantMsg(m); toggle(member.id).then(() => toggle(member.id)); }}
                                                        saving={grantSaving} setSaving={setGrantSaving}
                                                    />
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---- All Assignments tab ----

function AllTab() {
    const [certs, setCerts] = useState<Certification[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    useEffect(() => {
        fetch('/api/shop/certifications?all=true')
            .then(r => r.ok ? r.json() : [])
            .then(setCerts)
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <p style={{ color: 'gray' }}>Loading...</p>;

    const filtered = certs.filter(c =>
        (c.tool?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (c.user?.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (c.user?.email ?? '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
                <input
                    type="text"
                    className="glass-input"
                    placeholder="Filter by tool or member..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ flex: '1 1 220px', padding: '0.6rem 0.9rem' }}
                />
                <span style={{ fontSize: '0.85rem', color: 'gray', whiteSpace: 'nowrap' }}>{filtered.length} assignment{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            {filtered.length === 0 ? (
                <p style={{ color: 'gray' }}>No assignments found.</p>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.15)' }}>
                                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Tool</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Member</th>
                                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Email</th>
                                <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>Level</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((c, i) => (
                                <tr key={`${c.userId}-${c.toolId}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.025)' }}>
                                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{c.tool?.name ?? '?'}</td>
                                    <td style={{ padding: '0.5rem 0.75rem' }}>{c.user?.name ?? 'Unnamed'}</td>
                                    <td style={{ padding: '0.5rem 0.75rem', color: 'gray', fontSize: '0.8rem' }}>{c.user?.email}</td>
                                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>{levelBadge(c.level)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ---- Main page ----

export default function ToolManagementPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const hasFetched = useRef(false);

    const [tab, setTab] = useState<Tab>('tools');
    const [tools, setTools] = useState<Tool[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (status === "unauthenticated") router.push('/');
        else if (status === "authenticated" && !hasFetched.current) {
            hasFetched.current = true;
            Promise.all([
                fetch('/api/shop/tools').then(r => r.ok ? r.json() : []),
                fetch('/api/shop/members').then(r => r.ok ? r.json() : { members: [] }),
            ]).then(([toolData, memberData]) => {
                setTools(toolData);
                setMembers(memberData.members ?? []);
            }).finally(() => setLoading(false));
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    if (loading || status === "loading") {
        return <main className={styles.main}><div className="glass-container animate-float"><h2>Loading...</h2></div></main>;
    }

    const isSysadmin = session?.user?.sysadmin;
    const isBoardMember = session?.user?.boardMember;
    const isAdmin = isSysadmin || isBoardMember || session?.user?.shopSteward;

    const hasCertifierAuth = (session?.user?.toolStatuses ?? []).some(
        (ts: { level?: string }) => ts.level === 'MAY_CERTIFY_OTHERS'
    );
    const isCertifier = isSysadmin || isBoardMember || session?.user?.shopSteward || hasCertifierAuth;

    if (!isCertifier && !isAdmin) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Access Denied</h2>
                    <p style={{ color: '#ef4444' }}>Forbidden: You require the Shop Steward, Admin, Board Member, or Certifier role.</p>
                    <button className="glass-button" onClick={() => router.push('/shop')}>Back to Shop Ops</button>
                </div>
            </main>
        );
    }

    const reloadTools = () => {
        fetch('/api/shop/tools').then(r => r.ok ? r.json() : []).then(setTools);
    };

    const tabStyle = (t: Tab) => ({
        flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer' as const, transition: 'all 0.2s',
        background: tab === t ? 'rgba(56,189,248,0.2)' : 'transparent',
        color: tab === t ? '#38bdf8' : 'gray',
        fontWeight: tab === t ? 600 : 400,
        fontSize: '0.9rem',
    });

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '1060px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0, fontSize: '2.5rem' }}>Tools & Certifications</h1>
                    <Link href="/shop" className="glass-button" style={{ textDecoration: 'none' }}>&larr; Shop Dashboard</Link>
                </div>

                {/* Tab bar */}
                <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.75rem', background: 'rgba(255,255,255,0.05)', padding: '0.25rem', borderRadius: '12px' }}>
                    <button style={tabStyle('tools')} onClick={() => setTab('tools')}>All Tools</button>
                    <button style={tabStyle('person')} onClick={() => setTab('person')}>By Person</button>
                    {isAdmin && <button style={tabStyle('all')} onClick={() => setTab('all')}>All Assignments</button>}
                </div>

                {tab === 'tools' && <ToolsTab tools={tools} members={members} isAdmin={!!isAdmin} isCertifier={!!isCertifier} onToolsChange={reloadTools} />}
                {tab === 'person' && <PersonTab members={members} tools={tools} isCertifier={!!isCertifier} />}
                {tab === 'all' && <AllTab />}
            </div>
        </main>
    );
}
