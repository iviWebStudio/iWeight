import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="center">
      <div className="card state" style={{ maxWidth: 420 }}>
        <h1>Страница не найдена</h1>
        <p className="muted">Такой страницы нет. Вернитесь на главную.</p>
        <Link className="btn primary" href="/">
          На главную
        </Link>
      </div>
    </div>
  );
}
