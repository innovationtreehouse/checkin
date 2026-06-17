// Landing screen for a household whose membership is DENIED. By deliberate product
// decision this page leaks nothing — no reason, no contact, no membership wording, no
// sign-out affordance. Just the words "Access Denied". The middleware bounces every
// page navigation from a denied session here; APIs fail closed independently.
export const metadata = {
    title: "Access Denied",
};

export default function AccessDeniedPage() {
    return (
        <main
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "100vh",
                width: "100%",
            }}
        >
            <h1 style={{ fontWeight: 600, fontSize: "1.75rem", margin: 0 }}>Access Denied</h1>
        </main>
    );
}
