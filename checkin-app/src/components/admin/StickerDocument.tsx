"use client";

import React, { useMemo } from 'react';
import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';

// Font registration for a modern sans-serif look
Font.register({
    family: 'Roboto',
    src: 'https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf'
});
Font.register({
    family: 'Roboto-Bold',
    src: 'https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf'
});

// Create styles for Avery 22806 (8.5x11 paper, 12 stickers per page)
// 3 columns x 2" wide = 6", 2 gaps x 0.375" = 0.75"
// 4 rows x 2" high = 8", 3 gaps x 0.5" = 1.5"
// Margins: 0.875" horizontal and 0.75" vertical
const styles = StyleSheet.create({
    page: {
        paddingTop: '0.75in',
        paddingBottom: '0.75in',
        paddingLeft: '0.875in',
        paddingRight: '0.875in',
        flexDirection: 'row',
        flexWrap: 'wrap',
        backgroundColor: '#FFFFFF',
    },
    sticker: {
        width: '2in',
        height: '2in',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
        padding: '0.1in',
        // Optional border for testing alignment if needed:
        // border: '1px dashed #cccccc',
    },
    qrCode: {
        width: '1.25in',
        height: '1.25in',
    },
    nameText: {
        fontFamily: 'Roboto-Bold',
        fontSize: 12,
        textAlign: 'center',
        marginTop: 8,
        color: '#000000',
    }
});

interface ParticipantBadge {
    id: number;
    name: string;
    qrDataUri: string;
}

export default function StickerDocument({ badges }: { badges: ParticipantBadge[] }) {
    // Chunk badges into arrays of 12 for Avery 22806
    const chunkedBadges: ParticipantBadge[][] = useMemo(() => {
        const chunks = [];
        for (let i = 0; i < badges.length; i += 12) {
            chunks.push(badges.slice(i, i + 12));
        }
        return chunks;
    }, [badges]);

    return (
        <Document>
            {chunkedBadges.map((chunk, pageIndex) => (
                <Page size="LETTER" style={styles.page} key={`page-${pageIndex}`}>
                    {Array.from({ length: 12 }).map((_, idx) => {
                        const badge = chunk[idx];
                        const col = idx % 3;
                        const row = Math.floor(idx / 3);

                        const marginRight = col < 2 ? '0.375in' : 0;
                        const marginBottom = row < 3 ? '0.5in' : 0;

                        return (
                            <View key={`sticker-${idx}`} style={[styles.sticker, { marginRight, marginBottom }]}>
                                {badge ? (
                                    <>
                                        {/* eslint-disable-next-line jsx-a11y/alt-text */}
                                        <Image src={badge.qrDataUri} style={styles.qrCode} />
                                        <Text style={styles.nameText}>{badge.name || `User #${badge.id}`}</Text>
                                    </>
                                ) : null}
                            </View>
                        );
                    })}
                </Page>
            ))}
        </Document>
    );
}
