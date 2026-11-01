# MerchSys
**Requirements Document (RDR)** | _University Merchandise Pre-Order System_
Course: IT 118 Systems Integration and Architecture 1 | Program: BSIT, 3rd Year
Group: [Group Name] | Members: [Names and roles] | Date: [Date]

---

## 1. Introduction
MerchSys is a web-based system where students pre-order official university merchandise (hoodies, shirts, lanyards, etc.), pay online through GCash, and track their orders, while staff and administrators manage products, payments, and releases.

The system is an **integrated solution** made of four cooperating components:

| Component | Technology | Role |
|---|---|---|
| Web frontend | HTML, CSS, JavaScript, Bootstrap, Chart.js | Student shop and admin dashboard |
| Backend API | Node.js and Express (Vercel serverless) | Business logic, authentication, orchestration |
| Database, Auth, File storage | Supabase (PostgreSQL, Auth, Storage) | Persistent data, identity, product images and receipts |
| Payment gateway | PayMongo API (GCash, test mode) | Online payment and webhook confirmation |
| Email service | Resend API | Order and payment notifications |

This is an enhancement of the group's earlier IT 112 project (MerchSys), re-architected for integration: new database, new authentication, and three external service integrations.

## 2. Project Objectives
1. Centralize university merchandise pre-ordering in one system.
2. Automate payment verification by integrating a payment gateway (PayMongo) instead of manual receipt checking.
3. Keep students informed through automatic email notifications on order and payment events.
4. Give administrators real-time visibility through a dashboard with charts (revenue, order status, top products, payment methods).
5. Demonstrate a scalable, documented, multi-component architecture with tested data flow between components.

## 3. Stakeholders
| Stakeholder | Role | Interest |
|---|---|---|
| Students | Primary users | Easy ordering, convenient payment, order tracking |
| Staff | Operational users | Confirm payments, prepare and release orders |
| Administrators (e.g., student council or merchandise office) | Managers | Inventory control, sales reports, user management |
| Development team | Builders | Deliver a working, documented, integrated system |
| Course instructor | Evaluator | Meets IT 118 project requirements |
| Payment provider (PayMongo) and email provider (Resend) | External services | Correct API usage |

## 4. Business Requirements
- **BR-1** Reduce manual handling of payments and order records.
- **BR-2** Prevent overselling by tracking stock in real time.
- **BR-3** Provide accurate sales information for planning future merchandise runs.
- **BR-4** Provide a traceable record of every order and payment.

## 4.1 Project Scope
**In scope:** student registration and login; product catalog with images; cart and checkout; three payment options (GCash online via PayMongo, manual GCash with receipt upload, onsite payment); order tracking; staff/admin order and payment management; inventory with low-stock alerts; admin analytics dashboard; email notifications; role-based access control.

**Out of scope:** delivery or courier tracking; real-money (live mode) transactions; mobile native apps; multi-campus support; refunds through the payment gateway.

## 4.2 Project Constraints
- Academic timeline of about 5 weeks (proposal, design, development, testing, presentation).
- Uses free tiers (Supabase, Vercel, Resend, PayMongo test mode), which limit storage, emails, and request volume.
- PayMongo runs in **test mode** only; no real money is processed.
- Resend's default sender can only email the account owner until a domain is verified.
- Team of [N] students with limited development time.
- Requires internet access for all integrations.

## 5. Functional Requirements
### 5.1 Authentication and Accounts
- **FR-01** Students can register with name, email, and password (optionally restricted to the university email domain).
- **FR-02** Users can log in and log out; sessions use signed tokens.
- **FR-03** Users can update their profile and change their password.
- **FR-04** Administrators can view users and assign roles (student, staff, admin).

### 5.2 Products and Inventory
- **FR-05** Anyone can browse active products with price, stock, and pre-order deadline.
- **FR-06** Staff/admin can add, edit, and remove products, including image upload (stored in Supabase Storage).
- **FR-07** The system deducts stock when an order is placed and restores it when an order is cancelled.
- **FR-08** The system rejects orders for out-of-stock products or closed pre-order deadlines.
- **FR-09** The dashboard flags products at or below their low-stock threshold.

### 5.3 Ordering
- **FR-10** Students can add products to a cart and check out with a chosen payment method.
- **FR-11** Students can view their order history and the status of each order.
- **FR-12** Students can cancel their own orders while pending and unpaid.
- **FR-13** Staff/admin can search and filter orders by status, payment status, name, or order number.
- **FR-14** Staff/admin can move an order through: Pending, Approved, Ready for Pickup, Completed, or Cancelled, and set a pickup date.

### 5.4 Payments (Integration: PayMongo)
- **FR-15** For "GCash Online", the system creates a PayMongo Checkout Session and redirects the student to the hosted GCash payment page.
- **FR-16** The system receives PayMongo's webhook and **confirms the payment with PayMongo's API** before marking the order as paid.
- **FR-17** The system can re-check payment status on demand (for environments where webhooks cannot reach the server).
- **FR-18** For "Manual GCash", students upload a receipt image and reference number; staff verify and mark it paid.
- **FR-19** For "Onsite", staff confirm cash payment at pickup.
- **FR-20** Every confirmed payment is recorded in a payments table.

### 5.5 Notifications (Integration: Resend)
- **FR-21** The system emails the student when an order is placed.
- **FR-22** The system emails the student when payment is confirmed.
- **FR-23** The system emails the student when the order status changes (including pickup date).

### 5.6 Analytics Dashboard
- **FR-24** Show totals: revenue, orders, pending payments, completed orders, ready for pickup, low-stock products.
- **FR-25** Show charts: revenue and orders over the last 30 days, orders by status, top 5 products, and payment method split.

## 6. Non-Functional Requirements
### 6.1 Operational Requirements
- Runs on modern browsers (Chrome, Edge, Firefox, Safari) on desktop and mobile (responsive).
- Deployed on Vercel (frontend and API) with Supabase as the managed backend; no server maintenance needed.
- Environment secrets are stored in environment variables, never in source code.
- Can run locally with `npm run dev` for development and demo.

### 6.2 Performance Requirements
- Product list and dashboard load in under 2 seconds on a normal connection.
- Dashboard statistics come from a single database call; indexed queries on orders and order items.
- Public product list is cached at the CDN edge (30 seconds) with background refresh.
- Database hosted in the Singapore region to reduce latency from the Philippines.
- Stock deduction and order creation are one atomic transaction, so concurrent orders cannot oversell stock.

### 6.3 Security Requirements
- Passwords are handled by Supabase Auth (hashed); the app never stores plain passwords.
- All protected API routes require a valid access token; role checks enforce student/staff/admin permissions.
- Database tables have Row Level Security enabled; the browser cannot access the database directly.
- The service-role key and PayMongo secret key exist only on the server.
- Payment confirmation is verified against the PayMongo API, not trusted from request payloads.
- Receipts are stored in a private bucket and served only through short-lived signed URLs.
- File uploads are limited to images up to 5 MB; user input is validated on the server.

### 6.4 Cultural and Political Requirements
- Supports Philippine context: prices in PHP, GCash as the primary payment method, Asia/Manila dates in reports.
- Complies with the Data Privacy Act of 2012 (RA 10173): collects only needed data (name, email, course, order records) and restricts access by role.
- Interface language is English, with plain and student-friendly wording.
- Merchandise sales follow the university's policies on pre-order periods and authorized sellers.

## 7. References
- Supabase Documentation. https://supabase.com/docs
- PayMongo API Reference (Checkout Sessions, Webhooks). https://developers.paymongo.com
- Resend API Documentation. https://resend.com/docs
- Vercel Documentation (Express on Vercel). https://vercel.com/docs
- Republic Act No. 10173, Data Privacy Act of 2012.
- IT 118 Final Project Instructions and Rubric.
