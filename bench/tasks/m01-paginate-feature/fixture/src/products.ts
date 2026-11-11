export type Product = { id: string; name: string; price: number; tags: string[] };

export const PRODUCTS: Product[] = [
  { id: 'p1', name: 'Desk lamp', price: 24.5, tags: ['home', 'light'] },
  { id: 'p2', name: 'Notebook', price: 3.2, tags: ['office'] },
  { id: 'p3', name: 'Mechanical keyboard', price: 89, tags: ['office', 'tech'] },
  { id: 'p4', name: 'Plant pot', price: 12, tags: ['home'] },
  { id: 'p5', name: 'USB-C cable', price: 9.99, tags: ['tech'] },
  { id: 'p6', name: 'Bookshelf', price: 120, tags: ['home'] },
  { id: 'p7', name: 'Stapler', price: 7.5, tags: ['office'] },
];
