import React, { useState, useEffect } from 'react';
import { User } from 'react-feather';

const Login = ({ onLogin, isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = () => {
    fetch('https://cncivil04.pjn.gov.ar/api/users/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    })
      .then(response => {
        if (!response.ok) {
          throw new Error('Error al iniciar sesión');
        }
        return response.json();
      })
      .then(data => {
        if (data.success) {
          const userData = {
            username: data.username,
            role: data.role,
          };
          onLogin(userData);
        } else {
          throw new Error('Inicio de sesión fallido');
        }
      })
      .catch(error => {
        setError('Credenciales incorrectas. Por favor, inténtalo de nuevo.');
      });
  };

  const handleKeyPress = (event) => {
    if (event.key === 'Enter') {
      handleLogin();
    }
  };

  useEffect(() => {
    // Agrega una clase al body cuando el modal está abierto
    if (isOpen) {
      document.body.classList.add('modal-open');
    } else {
      // Remueve la clase cuando el modal está cerrado
      document.body.classList.remove('modal-open');
    }

    // Limpia el efecto al desmontar el componente
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen]);

  return (
    <div className={`fixed top-0 left-0 w-full h-full bg-neutral-950 ${isOpen ? 'grid' : 'hidden'} grid-rows-12`}>
      <div className="row-span-11 m-auto rounded-lg">
        <div className="m-auto h-full rounded-lg grid grid-rows-2 md:grid-cols-2 md:grid-rows-none gap-10 items-center justify-center">
          {/* Div de la izquierda */}
          <div className="flex flex-col items-center text-white">
            <User size="160" />

            <h2 className="text-3xl font-bold text-center mt-4 uppercase">Digesto <br />Administrativo</h2>
          </div>
          {/* Div de la derecha */}
          <div className="bg-white p-6 md:p-10 w-full w-72 md:w-96">
            <h3 className="text-2xl font-bold mb-4 uppercase">Iniciar sesión</h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                className="mb-4 p-2 border border-neutral-300 rounded col-span-2"
                type="text"
                id="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyPress={handleKeyPress} />
              <input
                className="mb-4 p-2 border border-neutral-300 rounded col-span-2"
                type="password"
                id="password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={handleKeyPress} />
              {error && <p className="text-red-500 mb-4 col-span-2">{error}</p>}
              <button
                onClick={handleLogin}
                className="bg-neutral-900 text-white p-2 rounded hover:bg-black col-span-2"
              >
                CONTINUAR
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
