-- Optional sample products (run after schema.sql AND migration-02-campuses.sql)
insert into public.products (name, description, price, stock, category, preorder_deadline) values
  ('BU Hoodie', 'Heavyweight fleece pullover hoodie', 850.00, 60, 'Clothes', now() + interval '30 days'),
  ('BU Varsity Tee', 'Cotton crew-neck tee with school logo', 350.00, 120, 'Clothes', now() + interval '30 days'),
  ('BU Tote Bag', 'Canvas tote bag, school print', 220.00, 80, 'Bags', now() + interval '30 days'),
  ('BU Cap', 'Adjustable embroidered cap', 280.00, 90, 'Caps', now() + interval '30 days'),
  ('BU Enamel Pin Set', 'Set of 3 enamel pins', 150.00, 150, 'Pins', now() + interval '30 days'),
  ('Lanyard + ID Holder', 'Woven lanyard with clear ID holder', 120.00, 200, 'Others', now() + interval '30 days');
