-- Optional sample products (run after schema.sql)
insert into public.products (name, description, price, stock, preorder_deadline) values
  ('University Hoodie', 'Heavyweight fleece pullover hoodie', 850.00, 60, now() + interval '30 days'),
  ('Varsity T-Shirt', 'Cotton crew-neck tee with school logo', 350.00, 120, now() + interval '30 days'),
  ('Lanyard + ID Holder', 'Woven lanyard with clear ID holder', 120.00, 200, now() + interval '30 days'),
  ('Tote Bag', 'Canvas tote bag, school print', 220.00, 80, now() + interval '30 days'),
  ('Tumbler 500ml', 'Stainless steel insulated tumbler', 480.00, 40, now() + interval '30 days');
