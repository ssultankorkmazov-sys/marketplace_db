// PLACEHOLDER rows shaped exactly like marketplace_db. Replace with the real seed data.
import type {User,Category,Product,Order,OrderItem,Payment,Review} from '../types/database'
export const users:User[]=[
{user_id:1,name:'Aruzhan Saparova',email:'aruzhan@mail.kz',phone:'+7 701 123 45 67',address:'Алматы, ул. Абая 10'},
{user_id:2,name:'Dias Nurlanov',email:'dias@mail.kz',phone:'+7 702 234 56 78',address:'Астана, пр. Кабанбай батыра 5'},
{user_id:3,name:'Madina Ospanova',email:'madina@mail.kz',phone:'+7 705 345 67 89',address:'Шымкент, ул. Тауке хана 22'}]
const C:[number,string][]=[[1,'Smartphones'],[2,'Laptops'],[3,'Tablets'],[4,'Headphones'],[5,'Gaming'],[6,'Home Appliances']]
export const categories:Category[]=C.map(([category_id,category_name])=>({category_id,category_name}))
const P:[number,string,string,number,number,number][]=[
[1,'iPhone 15','Apple smartphone, 128GB',399999,15,1],[2,'Samsung Galaxy S24','Flagship Android smartphone',449999,8,1],
[3,'MacBook Air M2','Apple laptop, 13.6" Retina',649999,5,2],[4,'Lenovo IdeaPad 3','Everyday laptop, 15.6" FHD',229999,20,2],
[5,'iPad Air','Apple tablet with M1 chip',329999,10,3],[6,'Galaxy Tab S9','Samsung Android tablet',379999,0,3],
[7,'AirPods Pro 2','Apple wireless earbuds, ANC',119999,30,4],[8,'Sony WH-1000XM5','Noise cancelling headphones',179999,12,4],
[9,'PlayStation 5','Sony gaming console',299999,6,5],[10,'Logitech G502','Gaming mouse',29999,40,5],
[11,'Dyson V15','Cordless vacuum cleaner',349999,4,6],[12,'Apple Watch Series 9','Apple smartwatch, GPS',199999,9,3]]
export const products:Product[]=P.map(([product_id,name,description,price,stock_quantity,category_id])=>({product_id,name,description,price,stock_quantity,category_id}))
export const orders:Order[]=[
{order_id:1,user_id:1,order_date:'2025-03-01T12:30:00',status:'Delivered',total_amount:519998},
{order_id:2,user_id:1,order_date:'2025-04-10T09:15:00',status:'Shipped',total_amount:29999},
{order_id:3,user_id:2,order_date:'2025-04-12T18:40:00',status:'Processing',total_amount:299999}]
export const orderItems:OrderItem[]=[
{order_item_id:1,order_id:1,product_id:1,quantity:1,unit_price:399999},{order_item_id:2,order_id:1,product_id:7,quantity:1,unit_price:119999},
{order_item_id:3,order_id:2,product_id:10,quantity:1,unit_price:29999},{order_item_id:4,order_id:3,product_id:9,quantity:1,unit_price:299999}]
export const payments:Payment[]=[
{payment_id:1,order_id:1,payment_date:'2025-03-01T12:35:00',amount:519998,payment_method:'Bank Card',status:'Paid'},
{payment_id:2,order_id:2,payment_date:'2025-04-10T09:20:00',amount:29999,payment_method:'Kaspi Pay',status:'Paid'},
{payment_id:3,order_id:3,payment_date:'2025-04-12T18:45:00',amount:299999,payment_method:'Cash on delivery',status:'Pending'}]
const R:[number,number,string][]=[[1,5,'Отличный телефон'],[2,4,'Хорошо, но дорого'],[3,5,'Быстрый и тихий'],[7,5,'Шумоподавление огонь'],[1,4,'Камера супер'],[9,5,'Лучшая консоль'],[8,5,'Звук отличный'],[4,4,'За свои деньги норм'],[10,5,'Удобная мышь'],[12,4,'Стильные часы']]
export const reviews:Review[]=R.map(([product_id,rating,comment],i)=>({review_id:i+1,user_id:(i%3)+1,product_id,rating,comment,review_date:`2025-04-${String(i+1).padStart(2,'0')}T10:00:00`}))
