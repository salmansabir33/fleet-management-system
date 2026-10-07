"""Generate a non-technical Fleet Tracker features PDF."""
from pathlib import Path

from fpdf import FPDF

OUT = Path(__file__).resolve().parent / "Fleet_Tracker_Features_Guide.pdf"

# Brand palette (professional teal / slate - not purple/cream AI defaults)
NAVY = (15, 39, 68)
TEAL = (14, 116, 144)
SLATE = (51, 65, 85)
MUTED = (100, 116, 139)
LIGHT = (241, 245, 249)
WHITE = (255, 255, 255)
ACCENT = (8, 145, 178)


class FeaturesPDF(FPDF):
    def __init__(self):
        super().__init__(format="A4", unit="mm")
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(18, 18, 18)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*TEAL)
        self.cell(0, 6, "Fleet Tracker  |  Features Guide", align="L")
        self.set_draw_color(*TEAL)
        self.set_line_width(0.3)
        y = self.get_y() + 7
        self.line(18, y, 192, y)
        self.set_y(y + 4)

    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-14)
        self.set_draw_color(*LIGHT)
        self.set_line_width(0.4)
        self.line(18, self.get_y(), 192, self.get_y())
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, f"Page {self.page_no() - 1}", align="C")

    def cover(self):
        self.add_page()
        # Top band
        self.set_fill_color(*NAVY)
        self.rect(0, 0, 210, 95, "F")
        self.set_fill_color(*TEAL)
        self.rect(0, 95, 210, 6, "F")

        self.set_y(28)
        self.set_font("Helvetica", "", 12)
        self.set_text_color(148, 163, 184)
        self.cell(0, 8, "PRODUCT FEATURES GUIDE", align="C", new_x="LMARGIN", new_y="NEXT")

        self.set_font("Helvetica", "B", 32)
        self.set_text_color(*WHITE)
        self.ln(4)
        self.cell(0, 14, "Fleet Tracker", align="C", new_x="LMARGIN", new_y="NEXT")

        self.set_font("Helvetica", "", 14)
        self.set_text_color(186, 230, 253)
        self.ln(2)
        self.multi_cell(
            0,
            7,
            "A clear guide to what the system does -\nwritten for business owners, managers, and operators.",
            align="C",
        )

        self.set_y(120)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(*NAVY)
        self.cell(0, 8, "What is Fleet Tracker?", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 11)
        self.set_text_color(*SLATE)
        self.ln(2)
        self.multi_cell(
            0,
            6.2,
            "Fleet Tracker is a GPS fleet management system that helps you see where "
            "your vehicles are, understand how they are being driven, keep maintenance "
            "on schedule, and stay informed when something needs attention - all from "
            "a simple web dashboard on desktop or phone.",
            align="C",
        )

        self.ln(10)
        box_y = self.get_y()
        self.set_fill_color(*LIGHT)
        self.rect(28, box_y, 154, 42, "F")
        self.set_xy(34, box_y + 6)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*TEAL)
        self.cell(0, 6, "Who this guide is for", new_x="LMARGIN", new_y="NEXT")
        self.set_x(34)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*SLATE)
        self.multi_cell(
            142,
            5.5,
            "Anyone who needs to understand the product without technical jargon - "
            "fleet owners, operations managers, supervisors, and vehicle owners. "
            "No IT background required.",
        )

        self.set_y(250)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*MUTED)
        self.cell(0, 5, "Prepared for business stakeholders", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 5, "Fleet Tracker  ·  Features Overview", align="C")

    def section_title(self, title):
        self.ln(3)
        needed = 28
        if self.get_y() + needed > 270:
            self.add_page()
        self.set_fill_color(*TEAL)
        self.set_text_color(*WHITE)
        self.set_font("Helvetica", "B", 13)
        self.cell(0, 9, f"  {title}", fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(4)

    def subsection(self, title):
        if self.get_y() > 255:
            self.add_page()
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*NAVY)
        self.cell(0, 7, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def body(self, text):
        self.set_font("Helvetica", "", 10)
        self.set_text_color(*SLATE)
        self.multi_cell(0, 5.5, text)
        self.ln(2)

    def bullet(self, text, bold_lead=None):
        if self.get_y() > 270:
            self.add_page()
        x = self.l_margin
        self.set_x(x)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*TEAL)
        self.cell(5, 5.5, "-")
        if bold_lead:
            self.set_font("Helvetica", "B", 10)
            self.set_text_color(*NAVY)
            self.cell(self.get_string_width(bold_lead) + 1, 5.5, bold_lead)
            self.set_font("Helvetica", "", 10)
            self.set_text_color(*SLATE)
            self.multi_cell(0, 5.5, text)
        else:
            self.set_font("Helvetica", "", 10)
            self.set_text_color(*SLATE)
            self.multi_cell(0, 5.5, text)
        self.ln(0.8)

    def callout(self, title, text):
        if self.get_y() > 245:
            self.add_page()
        y = self.get_y()
        self.set_fill_color(236, 254, 255)
        self.set_draw_color(*TEAL)
        # Estimate height
        self.set_font("Helvetica", "", 9.5)
        # Use a temporary measure via multi_cell later
        start_y = self.get_y()
        self.set_xy(self.l_margin + 2, start_y + 3)
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(*TEAL)
        self.cell(0, 5, title, new_x="LMARGIN", new_y="NEXT")
        self.set_x(self.l_margin + 2)
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*SLATE)
        self.multi_cell(self.epw - 4, 5, text)
        end_y = self.get_y() + 3
        # Draw background behind (re-draw by covering - simpler: draw before content)
        # Actually we already wrote content; skip complex redraw. Use left bar instead.
        self.set_draw_color(*TEAL)
        self.set_line_width(1.2)
        self.line(self.l_margin, start_y + 1, self.l_margin, end_y - 1)
        self.set_line_width(0.2)
        self.set_y(end_y)
        self.ln(2)

    def role_card(self, role, summary, bullets):
        if self.get_y() > 220:
            self.add_page()
        self.set_fill_color(*LIGHT)
        start = self.get_y()
        self.set_xy(self.l_margin + 3, start + 3)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*TEAL)
        self.cell(0, 6, role, new_x="LMARGIN", new_y="NEXT")
        self.set_x(self.l_margin + 3)
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*SLATE)
        self.multi_cell(self.epw - 6, 5, summary)
        for b in bullets:
            self.set_x(self.l_margin + 3)
            self.set_font("Helvetica", "", 9.5)
            self.set_text_color(*SLATE)
            self.multi_cell(self.epw - 6, 5, f"  -  {b}")
        end = self.get_y() + 3
        # left accent
        self.set_draw_color(*TEAL)
        self.set_line_width(1.5)
        self.line(self.l_margin, start, self.l_margin, end)
        self.set_line_width(0.2)
        self.set_y(end + 3)


def build():
    pdf = FeaturesPDF()
    pdf.cover()

    # TOC-ish intro
    pdf.add_page()
    pdf.section_title("1. What the System Helps You Do")
    pdf.body(
        "Fleet Tracker brings your vehicles, drivers, trips, alerts, routes, and "
        "maintenance into one place. Instead of calling drivers or guessing where a "
        "vehicle is, you open the dashboard and see the current picture - live on a map, "
        "with history you can replay, and alerts when something goes wrong."
    )
    pdf.bullet("Know where every vehicle is right now.", bold_lead="See live locations. ")
    pdf.bullet("Replay past journeys and review completed trips.", bold_lead="Review history. ")
    pdf.bullet("Get notified about speeding, leaving allowed areas, harsh driving, and more.", bold_lead="Stay alert. ")
    pdf.bullet("Confirm who drove each trip and which route was used.", bold_lead="Account for work. ")
    pdf.bullet("Track service due dates and log workshop visits.", bold_lead="Plan maintenance. ")
    pdf.bullet("Give the right people the right access - owners, managers, and admins.", bold_lead="Control access. ")

    pdf.callout(
        "In plain terms",
        "Think of it as a control room for your fleet: a live map, a trip logbook, "
        "a safety alarm system, a route planner, and a maintenance diary - working together.",
    )

    # Roles
    pdf.section_title("2. Who Uses the System")
    pdf.body(
        "Different people need different views. Fleet Tracker is organized around roles "
        "so each person only sees what they need, and nothing they should not."
    )

    pdf.role_card(
        "Admin (Fleet Owner / Operations Lead)",
        "Full control of one fleet: vehicles, users, drivers, managers, routes, geofences, "
        "settings, fuel prices, and reports.",
        [
            "Adds and manages all vehicles and people in the fleet",
            "Sets permissions and notification rules",
            "Reviews dashboards, trips, alerts, and maintenance across the whole fleet",
        ],
    )
    pdf.role_card(
        "Manager (Supervisor)",
        "Oversees a group of users and their vehicles. Sees dashboards, maps, trips, "
        "alerts, and maintenance for their team - based on permissions granted by Admin.",
        [
            "Monitors assigned vehicles and drivers day to day",
            "Can confirm trip drivers and routes when allowed",
            "Receives alerts for the vehicles they supervise",
        ],
    )
    pdf.role_card(
        "User (Vehicle Owner / Operator)",
        "Focused view of their own vehicle: live location, playback, trips, alerts, "
        "and maintenance - according to permissions.",
        [
            "Tracks their vehicle on the map",
            "Reviews trip history and alerts for that vehicle",
            "Logs or reviews maintenance when permitted",
        ],
    )
    pdf.role_card(
        "Super Admin (Platform Operator)",
        "Works across fleets: manages Admin accounts and can enter a specific fleet "
        "when support or setup is needed.",
        [
            "Creates and oversees fleet Admins",
            "Handles unassigned or orphaned assets when needed",
            "Does not replace day-to-day fleet operations",
        ],
    )

    # Live tracking
    pdf.section_title("3. Live Vehicle Tracking")
    pdf.subsection("See your fleet on the map")
    pdf.body(
        "The live map shows where each vehicle is, whether it is moving, idle, or stopped, "
        "and key status at a glance. Positions refresh automatically so you are looking at "
        "near real-time information - typically updated every few seconds."
    )
    pdf.bullet("Current location on an interactive map", bold_lead="Location - ")
    pdf.bullet("Moving, idle (engine on but not moving), or stopped", bold_lead="Motion status - ")
    pdf.bullet("Current speed in km/h", bold_lead="Speed - ")
    pdf.bullet("Direction the vehicle is facing / traveling", bold_lead="Heading - ")
    pdf.bullet("When the vehicle last reported in", bold_lead="Last seen - ")
    pdf.bullet("Ignition and battery information when the tracker provides it", bold_lead="Vehicle signals - ")

    pdf.subsection("Vehicle details")
    pdf.body(
        "Each vehicle has a profile you can manage: name, plate number, vehicle type "
        "(car, bike, van, truck, and similar), photo, fuel type, and average fuel use "
        "while driving and while idling. You can also set a personal speed limit and "
        "harsh-driving sensitivity for that vehicle."
    )
    pdf.callout(
        "Why it matters",
        "A dispatch or operations person can answer \"Where is vehicle X?\" in seconds, "
        "without calling the driver - and spot idle time or unexpected stops early.",
    )

    # Playback & trips
    pdf.section_title("4. Trip History & Playback")
    pdf.subsection("Automatic trip logging")
    pdf.body(
        "As vehicles leave and return through their assigned home area (geofence), "
        "the system records trips automatically. Each trip captures start and end time, "
        "distance, duration, fuel estimates, and driving behavior metrics."
    )
    pdf.bullet("Start and end time and locations", bold_lead="When & where - ")
    pdf.bullet("Distance traveled and time on the road", bold_lead="Distance & duration - ")
    pdf.bullet("Estimated fuel used while driving and while idling, plus fuel cost", bold_lead="Fuel - ")
    pdf.bullet("Optional toll and challan (fine) amounts you can record", bold_lead="Extra costs - ")
    pdf.bullet("Max speed, overspeed events, harsh braking and acceleration, idle counts", bold_lead="Driving behavior - ")

    pdf.subsection("Confirm driver and route")
    pdf.body(
        "After a trip, Admin or Manager can confirm who actually drove and which planned "
        "route was used. Confirmation is separate from the vehicle's usual driver assignment, "
        "so temporary swaps (borrowing a driver) are handled cleanly."
    )
    pdf.bullet("Who drove this trip (with optional borrow-from-another-vehicle support)", bold_lead="Driver confirmation - ")
    pdf.bullet("Which planned route this trip followed", bold_lead="Route confirmation - ")
    pdf.bullet("Reminders when a trip still needs confirmation", bold_lead="Pending alerts - ")

    pdf.subsection("Live playback")
    pdf.body(
        "Playback lets you rewind a vehicle's journey for a chosen time range. "
        "You can watch the path on the map - useful for investigating complaints, "
        "verifying deliveries, or reviewing an incident."
    )

    # Geofences
    pdf.section_title("5. Geofences (Allowed Areas)")
    pdf.body(
        "A geofence is a virtual boundary drawn on the map - for example a depot, "
        "warehouse, customer site, or city zone. Vehicles can be linked to a primary "
        "geofence so the system knows their \"home\" area."
    )
    pdf.bullet("Draw and name areas on the map", bold_lead="Create zones - ")
    pdf.bullet("Link a vehicle to its primary (home) geofence", bold_lead="Assign vehicles - ")
    pdf.bullet("Get a critical alert when a vehicle leaves its assigned area", bold_lead="Exit alerts - ")
    pdf.bullet("Use geofences to help start and complete trip records", bold_lead="Trip boundaries - ")
    pdf.callout(
        "Business example",
        "If a delivery van should stay within a city zone, leaving that zone can raise "
        "an alert immediately so a supervisor can check in with the driver.",
    )

    # Routes
    pdf.section_title("6. Planned Routes")
    pdf.body(
        "Routes are paths you expect vehicles to follow (for example depot -> customer A -> "
        "customer B -> depot). You can create a route, preview it on the map, assign "
        "vehicles to it, and later see how closely actual trips matched the plan."
    )
    pdf.bullet("Create start/end (and via) points and preview the path", bold_lead="Design routes - ")
    pdf.bullet("Assign one or more vehicles to a route", bold_lead="Assign vehicles - ")
    pdf.bullet("See how closely a trip followed the planned path (match percentage)", bold_lead="Match trips - ")
    pdf.bullet("Spot deviation segments where the vehicle left the planned path", bold_lead="Find deviations - ")
    pdf.bullet("Alert when significant route deviation is detected", bold_lead="Route deviation alerts - ")
    pdf.body(
        "Confirming a route on a trip records which planned route was actually used "
        "for that journey, without changing the vehicle's long-term assignment."
    )

    # Drivers
    pdf.section_title("7. Driver Management")
    pdf.body(
        "Keep a driver roster with identity and license details, then assign drivers "
        "to vehicles. Assignment history is retained so you can see who was on which "
        "vehicle over time."
    )
    pdf.bullet("Name, CNIC / ID card number, phone, license number and expiry", bold_lead="Driver profile - ")
    pdf.bullet("Active, inactive, or on leave", bold_lead="Status - ")
    pdf.bullet("Photo and license scan uploads", bold_lead="Documents - ")
    pdf.bullet("Assign / unassign a driver to a vehicle", bold_lead="Vehicle assignment - ")
    pdf.bullet("View assignment history and driver detail pages", bold_lead="History - ")
    pdf.bullet("Alert when a trip is in progress but no driver is assigned", bold_lead="Unassigned driver alert - ")

    # Alerts
    pdf.section_title("8. Alerts & Notifications")
    pdf.body(
        "The system watches vehicle behavior continuously and raises alerts when "
        "something needs attention. Alerts can be turned on or off by type at the "
        "fleet level, and each person can choose which types ring their notification bell."
    )
    pdf.subsection("Alert types you can monitor")
    pdf.bullet("Vehicle exceeds its speed limit (fleet default or per-vehicle)", bold_lead="Overspeed - ")
    pdf.bullet("Sudden hard braking or hard acceleration", bold_lead="Harsh driving - ")
    pdf.bullet("Vehicle leaves its primary geofence", bold_lead="Geofence exit - ")
    pdf.bullet("Vehicle strays significantly from its planned route", bold_lead="Route deviation - ")
    pdf.bullet("Mobile tracker stops reporting (possible theft / signal loss)", bold_lead="Silence / offline - ")
    pdf.bullet("A trip is running without a driver assigned", bold_lead="Driver unassigned - ")
    pdf.bullet("Trip still needs driver or route confirmation", bold_lead="Pending confirmation - ")
    pdf.bullet("Service items approaching due or already overdue", bold_lead="Maintenance due - ")

    pdf.subsection("How alerts are handled")
    pdf.bullet("Open alerts appear in a notifications / alerts feed", bold_lead="Inbox - ")
    pdf.bullet("Severity helps prioritize (for example critical vs warning)", bold_lead="Priority - ")
    pdf.bullet("Authorized users can resolve alerts when the issue is handled", bold_lead="Resolve - ")
    pdf.bullet("Per-person preferences control which alert types notify them", bold_lead="Personal prefs - ")
    pdf.callout(
        "Why it matters",
        "You do not need to stare at the map all day. The system watches for you and "
        "surfaces problems - speeding, unauthorized exits, missing drivers, overdue service - "
        "so the right person can act quickly.",
    )

    # Dashboard & reports
    pdf.section_title("9. Dashboards & Reports")
    pdf.subsection("At-a-glance dashboard")
    pdf.body(
        "Admin and Manager dashboards summarize fleet health for a selected period: "
        "how many vehicles are active, trip counts, alert volumes, and maintenance status. "
        "Trend charts show how activity and issues change over time."
    )
    pdf.bullet("Vehicle and trip activity overview", bold_lead="Operations snapshot - ")
    pdf.bullet("Alert counts and recent issues", bold_lead="Safety pulse - ")
    pdf.bullet("Vehicles due or overdue for maintenance", bold_lead="Maintenance status - ")
    pdf.bullet("Trends over days or weeks for trips, alerts, and service", bold_lead="Trends - ")

    pdf.subsection("Vehicle reports")
    pdf.body(
        "For a chosen vehicle and date range, reports summarize distance, speeds, "
        "idle behavior, harsh events, overspeeding, and related metrics - useful for "
        "performance reviews, fuel discussions, and safety coaching."
    )

    # Maintenance
    pdf.section_title("10. Vehicle Maintenance")
    pdf.body(
        "Maintenance helps you stop relying on memory or paper logs. Each vehicle can "
        "track service items (engine oil, filters, and similar catalog items) by "
        "distance and/or engine hours, with defaults by vehicle type and optional "
        "per-vehicle overrides."
    )
    pdf.bullet("Set a starting baseline (odometer / engine hours) for each vehicle", bold_lead="Baseline setup - ")
    pdf.bullet("See what is OK, due soon, or overdue", bold_lead="Due status - ")
    pdf.bullet("Log workshop visits with date, odometer, costs, notes, and line items", bold_lead="Service records - ")
    pdf.bullet("Adjust intervals per vehicle when needed", bold_lead="Custom intervals - ")
    pdf.bullet("Receive maintenance alerts before and after items become overdue", bold_lead="Reminders - ")
    pdf.bullet("Review maintenance history and cost over time", bold_lead="History & cost - ")
    pdf.callout(
        "Business example",
        "Instead of discovering a missed oil change after a breakdown, the dashboard "
        "shows \"due soon\" early enough to schedule the workshop visit.",
    )

    # Fuel
    pdf.section_title("11. Fuel Types & Prices")
    pdf.body(
        "Admins can maintain fuel types and current (and historical) fuel prices. "
        "Combined with each vehicle's average consumption figures, trip records can "
        "estimate fuel used and fuel cost in local currency - helping you understand "
        "operating cost per trip and over time."
    )
    pdf.bullet("Define fuel types used by the fleet", bold_lead="Fuel types - ")
    pdf.bullet("Record price updates over time", bold_lead="Price history - ")
    pdf.bullet("Estimate driving and idle fuel use on trips", bold_lead="Trip fuel estimates - ")
    pdf.bullet("See estimated fuel cost on completed trips", bold_lead="Cost visibility - ")

    # Users, managers, permissions
    pdf.section_title("12. People, Permissions & Access")
    pdf.subsection("Users and vehicle ownership")
    pdf.body(
        "Users are people in your organization. A user can own one vehicle. "
        "Managers oversee groups of users (and through them, those users' vehicles). "
        "Admins run the whole fleet."
    )

    pdf.subsection("Permissions (what someone is allowed to do)")
    pdf.body(
        "Permissions are fine-grained. Admins decide which capabilities Managers "
        "(and, where applicable, Users) receive. Examples include:"
    )
    pdf.bullet("View live map and positions", bold_lead="Live tracking - ")
    pdf.bullet("View and resolve alerts", bold_lead="Alerts & notifications - ")
    pdf.bullet("View trip history", bold_lead="Trip history - ")
    pdf.bullet("Manage vehicles", bold_lead="Vehicle management - ")
    pdf.bullet("Manage drivers and assignments", bold_lead="Driver management - ")
    pdf.bullet("Manage users", bold_lead="User management - ")
    pdf.bullet("Create and edit geofences", bold_lead="Geofence management - ")
    pdf.bullet("Create and edit routes", bold_lead="Route management - ")
    pdf.bullet("Log and edit maintenance", bold_lead="Maintenance - ")
    pdf.bullet("Manage fuel prices", bold_lead="Fuel prices - ")
    pdf.bullet("View reports and analytics", bold_lead="Reports & analytics - ")

    pdf.subsection("Secure sign-in")
    pdf.body(
        "People sign in with their own account. Sessions can be refreshed securely. "
        "Access is limited to the fleet and the permissions attached to that account."
    )

    # Settings
    pdf.section_title("13. Settings & Preferences")
    pdf.bullet("Turn alert types on/off for the whole fleet", bold_lead="Alert type settings - ")
    pdf.bullet("Choose which alert types Managers may receive", bold_lead="Offered notifications - ")
    pdf.bullet("Maintain the permission catalog and defaults for new people", bold_lead="Permission catalog - ")
    pdf.bullet("Personal notification preferences (which bells ring for me)", bold_lead="My preferences - ")
    pdf.bullet("Dashboard appearance and period filters for viewing trends", bold_lead="Display prefs - ")
    pdf.bullet("Works on desktop and mobile browsers", bold_lead="Responsive design - ")

    # Multi-fleet
    pdf.section_title("14. Multi-Fleet Organization")
    pdf.body(
        "The platform supports multiple fleets (tenants). Each Admin's fleet is isolated: "
        "vehicles, users, drivers, geofences, routes, and trips belong to that fleet. "
        "A Super Admin can oversee Admins and help with unassigned assets, without mixing "
        "one company's data into another's day-to-day view."
    )
    pdf.callout(
        "Privacy & clarity",
        "Managers and Users only see the people and vehicles in their scope. "
        "That keeps screens simpler and protects information that should stay within a team.",
    )

    # Benefits summary
    pdf.section_title("15. Benefits at a Glance")
    pdf.bullet("Always know where the fleet is - without phone calls.", bold_lead="Visibility - ")
    pdf.bullet("Catch speeding, harsh driving, and unauthorized exits early.", bold_lead="Safety - ")
    pdf.bullet("Reduce theft risk with silence / offline monitoring on mobile trackers.", bold_lead="Security - ")
    pdf.bullet("Prove where a vehicle went with playback and trip records.", bold_lead="Accountability - ")
    pdf.bullet("Confirm drivers and routes for cleaner operations records.", bold_lead="Operations discipline - ")
    pdf.bullet("Estimate fuel use and cost per trip.", bold_lead="Cost awareness - ")
    pdf.bullet("Keep service on schedule and record workshop history.", bold_lead="Asset care - ")
    pdf.bullet("Give each role only the tools they need.", bold_lead="Controlled access - ")
    pdf.bullet("Use one system on computer or phone.", bold_lead="Anywhere access - ")

    # Closing
    pdf.section_title("16. Typical Daily Workflow")
    pdf.body("A simple picture of how teams use Fleet Tracker day to day:")
    pdf.bullet("Open the dashboard and map; check which vehicles are moving, idle, or offline.", bold_lead="Morning - ")
    pdf.bullet("Respond to any open alerts (overspeed, geofence exit, unassigned driver, etc.).", bold_lead="During the day - ")
    pdf.bullet("Confirm drivers/routes on completed trips; review playback if something looks wrong.", bold_lead="After trips - ")
    pdf.bullet("Check maintenance due list and schedule workshop visits; log completed service.", bold_lead="Ongoing - ")
    pdf.bullet("Review trends and vehicle reports for coaching and planning.", bold_lead="Weekly / monthly - ")

    pdf.ln(6)
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(*WHITE)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 10, "  Ready to see more?", fill=True, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*SLATE)
    pdf.multi_cell(
        0,
        5.5,
        "This guide describes the product features available in Fleet Tracker. "
        "For a live walkthrough, ask your system administrator or implementation partner "
        "to demonstrate the Admin, Manager, and User views with your own vehicles.",
    )
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        5,
        "Document purpose: non-technical product overview for stakeholders. "
        "Feature availability depends on role permissions and fleet configuration.",
    )

    pdf.output(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
