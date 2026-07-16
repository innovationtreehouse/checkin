"use client";

import { Badge, type BadgeProps, Button, Group, Text } from "@mantine/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * URL-synced single-status list filter for the ops pages: clicking a status
 * badge shows only rows in that status; clicking it again (or the notice's
 * clear button) shows everything. The active value lives in a query param so
 * a filtered view survives refresh and can be linked. Client-side only — the
 * ops lists are already fully loaded, so callers just apply
 * `rows.filter((r) => !active || r.status === active)`.
 */
export function useStatusFilter(param: string = "status") {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const active = searchParams.get(param);

    const setParam = useCallback(
        (value: string | null) => {
            const params = new URLSearchParams(searchParams.toString());
            if (value === null) params.delete(param);
            else params.set(param, value);
            const qs = params.toString();
            // replace (not push): filter flips shouldn't pile up in history.
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [router, pathname, searchParams, param],
    );

    const toggle = useCallback(
        (value: string) => setParam(active === value ? null : value),
        [active, setParam],
    );
    const clear = useCallback(() => setParam(null), [setParam]);

    return { active, toggle, clear };
}

/**
 * A status Badge that acts as the filter toggle. Filled when it is the active
 * filter, light otherwise; exposes the state to assistive tech via
 * aria-pressed. Everything else (color, size, children) is the caller's.
 */
export function StatusFilterBadge({
    value,
    active,
    onToggle,
    children,
    ...badgeProps
}: {
    value: string;
    active: string | null;
    onToggle: (value: string) => void;
    children: React.ReactNode;
} & Omit<BadgeProps, "variant">) {
    const isActive = active === value;
    return (
        <Badge
            {...badgeProps}
            component="button"
            type="button"
            onClick={() => onToggle(value)}
            variant={isActive ? "filled" : "light"}
            aria-pressed={isActive}
            title={isActive ? "Clear this filter" : "Show only this status"}
            style={{ cursor: "pointer", ...badgeProps.style }}
        >
            {children}
        </Badge>
    );
}

/** One-line "filtering is on" notice with the way out. Renders nothing when inactive. */
export function ActiveFilterNotice({
    active,
    label,
    onClear,
}: {
    active: string | null;
    label: (status: string) => string;
    onClear: () => void;
}) {
    if (!active) return null;
    return (
        <Group gap="xs">
            <Text size="sm" c="dimmed">
                Showing only <Text component="span" fw={600}>{label(active)}</Text>
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={onClear}>
                Clear filter
            </Button>
        </Group>
    );
}
