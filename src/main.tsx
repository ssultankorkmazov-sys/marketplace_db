import {createRoot} from 'react-dom/client'
import {BrowserRouter} from 'react-router-dom'
import './index.css'
import {StoreProvider} from './context/Store'
import App from './App'
import {AuthProvider} from './context/Auth'
createRoot(document.getElementById('root')!).render(<BrowserRouter basename={import.meta.env.BASE_URL}><AuthProvider><StoreProvider><App/></StoreProvider></AuthProvider></BrowserRouter>)
