export default function RecentActivity() {
  return (
    <section className="recent-card">
      <h2>Recent activity</h2>

      <div className="card-divider" />

      <div className="empty-activity">
        <div className="package-icon">
          <div className="package-top" />
          <div className="package-body">
            <span />
          </div>
        </div>

        <p>No recent activity</p>
      </div>
    </section>
  );
}