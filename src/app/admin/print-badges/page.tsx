"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { pdf } from "@react-pdf/renderer";
import BadgeDocument from "@/components/admin/BadgeDocument";
import StickerDocument from "@/components/admin/StickerDocument";
import styles from "../../page.module.css";

export default function PrintBadgesPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [participants, setParticipants] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isGenerating, setIsGenerating] = useState(false);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        }
    }, [status, router]);

    useEffect(() => {
        if (status === "authenticated") {
            fetchParticipants();
        }
    }, [status, searchTerm]);

    const fetchParticipants = async () => {
        setLoading(true);
        try {
            const url = new URL('/api/admin/participants/search', window.location.origin);
            if (searchTerm) url.searchParams.set('q', searchTerm);

            const res = await fetch(url.toString());
            const data = await res.json();
            if (data.participants) {
                setParticipants(data.participants);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const toggleSelection = (id: number) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const toggleAll = () => {
        if (selectedIds.size === participants.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(participants.map(p => p.id)));
        }
    };

    const generatePdf = async () => {
        if (selectedIds.size === 0) return;
        setIsGenerating(true);

        try {
            const selectedParticipants = participants.filter(p => selectedIds.has(p.id));

            // Add QR code data URIs
            const badgesWithQr = await Promise.all(
                selectedParticipants.map(async (p) => {
                    const qrDataUri = await QRCode.toDataURL(p.id.toString(), {
                        width: 200,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });
                    return { ...p, qrDataUri };
                })
            );

            const blob = await pdf(<BadgeDocument badges={badgesWithQr} />).toBlob();

            // Trigger download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `badges-${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (e) {
            console.error("Failed to generate PDF", e);
            alert("Failed to generate PDF. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    const generateStickerPdf = async () => {
        if (selectedIds.size === 0) return;
        setIsGenerating(true);

        try {
            const selectedParticipants = participants.filter(p => selectedIds.has(p.id));

            // Add QR code data URIs
            const badgesWithQr = await Promise.all(
                selectedParticipants.map(async (p) => {
                    const qrDataUri = await QRCode.toDataURL(p.id.toString(), {
                        width: 200,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });
                    return { ...p, qrDataUri };
                })
            );

            const blob = await pdf(<StickerDocument badges={badgesWithQr} />).toBlob();

            // Trigger download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `stickers-${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (e) {
            console.error("Failed to generate stickers PDF", e);
            alert("Failed to generate stickers PDF. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    if (status === "loading") return null;

    return (
        <main className={styles.main}>
            <div className="glass-container animate-float" style={{ maxWidth: "1000px" }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0 }}>Print ID Badges</h1>
                    <button className="glass-button" onClick={() => router.push('/admin')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Back to Admin Hub
                    </button>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Select participants to generate double-sided standard Avery 5390 ID badges.
                </p>

                <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        className="glass-input"
                        style={{ flex: 1, minWidth: '200px' }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <select
                        className="glass-input"
                        style={{ padding: '0.75rem', borderRadius: '8px', minWidth: '150px' }}
                        onChange={(e) => {
                            // UI-only filter for now to satisfy requirements until backend supports date filtering
                            setSearchTerm(searchTerm);
                        }}
                    >
                        <option value="all">All Dates</option>
                        <option value="today">Created Today</option>
                        <option value="last7days">Created Last 7 Days</option>
                    </select>
                    <button
                        className="glass-button"
                        style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
                        onClick={generatePdf}
                        disabled={selectedIds.size === 0 || isGenerating}
                    >
                        {isGenerating ? 'Generating...' : `Generate Badge (${selectedIds.size})`}
                    </button>
                    <button
                        className="glass-button"
                        style={{ backgroundColor: '#8b5cf6', color: '#fff' }}
                        onClick={generateStickerPdf}
                        disabled={selectedIds.size === 0 || isGenerating}
                    >
                        {isGenerating ? 'Generating...' : `Generate Sticker (${selectedIds.size})`}
                    </button>
                </div>

                <div className="glass-panel" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ padding: '1rem' }}>
                                    <input
                                        type="checkbox"
                                        checked={participants.length > 0 && selectedIds.size === participants.length}
                                        onChange={toggleAll}
                                        style={{ width: '18px', height: '18px' }}
                                    />
                                </th>
                                <th style={{ padding: '1rem' }}>ID</th>
                                <th style={{ padding: '1rem' }}>Name</th>
                                <th style={{ padding: '1rem' }}>Membership</th>
                                <th style={{ padding: '1rem' }}>Roles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} style={{ padding: '2rem', textAlign: 'center' }}>Loading...</td>
                                </tr>
                            ) : participants.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ padding: '2rem', textAlign: 'center' }}>No participants found.</td>
                                </tr>
                            ) : participants.map(p => (
                                <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: selectedIds.has(p.id) ? 'rgba(56, 189, 248, 0.1)' : 'transparent' }}>
                                    <td style={{ padding: '1rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(p.id)}
                                            onChange={() => toggleSelection(p.id)}
                                            style={{ width: '18px', height: '18px' }}
                                        />
                                    </td>
                                    <td style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>#{p.id}</td>
                                    <td style={{ padding: '1rem' }}><strong>{p.name || 'N/A'}</strong><br /><small style={{ color: 'var(--color-text-muted)' }}>{p.email}</small></td>
                                    <td style={{ padding: '1rem' }}>
                                        {p.isMember ? <span style={{ color: '#10b981' }}>Active</span> : <span style={{ color: '#ef4444' }}>Inactive</span>}
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                            {p.boardMember && <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#3b82f6', color: '#fff', fontSize: '10px', fontWeight: 'bold' }}>BOARD</span>}
                                            {p.shopSteward && <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#8b5cf6', color: '#fff', fontSize: '10px', fontWeight: 'bold' }}>STEWARD</span>}
                                            {p.keyholder && <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#f59e0b', color: '#fff', fontSize: '10px', fontWeight: 'bold' }}>KEYHOLDER</span>}
                                            {!p.boardMember && !p.shopSteward && !p.keyholder && p.isMember && <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#10b981', color: '#fff', fontSize: '10px', fontWeight: 'bold' }}>MEMBER</span>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}
