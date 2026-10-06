export interface User{user_id:number;name:string;email:string;phone:string;address:string|null}
export interface Category{category_id:number;category_name:string}
export interface Product{product_id:number;name:string;description:string|null;price:number;stock_quantity:number;category_id:number}
export interface Order{order_id:number;user_id:number;order_date:string;status:string;total_amount:number}
export interface OrderItem{order_item_id:number;order_id:number;product_id:number;quantity:number;unit_price:number}
export interface Payment{payment_id:number;order_id:number;payment_date:string;amount:number;payment_method:string;status:string}
export interface Review{review_id:number;user_id:number;product_id:number;rating:number;comment:string|null;review_date:string}
