/* Сайт-визитка: одна длинная страница с разделами, как старый сайт на
   Tilda, — меню ведёт по якорям (#uslugi, #kontakty). React Router остаётся
   ради страницы «нет такого адреса» и будущих отдельных страниц (например,
   своя страница у каждой услуги). */

import { Route, Routes } from 'react-router-dom';

import { PriceDialogProvider } from '@/components/PriceDialog';
import { About } from '@/sections/About';
import { Clients } from '@/sections/Clients';
import { Contacts } from '@/sections/Contacts';
import { Footer } from '@/sections/Footer';
import { Header } from '@/sections/Header';
import { Hero } from '@/sections/Hero';
import { Portfolio } from '@/sections/Portfolio';
import { Requirements } from '@/sections/Requirements';
import { Services } from '@/sections/Services';

export function App() {
  return (
    <PriceDialogProvider>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </PriceDialogProvider>
  );
}

function Home() {
  return (
    <>
      <Hero />
      <About />
      <Services />
      <Portfolio />
      <Requirements />
      <Clients />
      <Contacts />
    </>
  );
}

function NotFound() {
  return (
    <section className="sec not-found">
      <div className="wrap">
        <p className="eyebrow">404</p>
        <h1>Такой страницы нет</h1>
        <p>
          Возможно, адрес набран с ошибкой. <a href="/">На главную</a>
        </p>
      </div>
    </section>
  );
}
