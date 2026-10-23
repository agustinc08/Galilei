import React, { useState } from 'react';
import { LogOut, LogIn } from 'react-feather';
import ModalConfirmar from './ModalConfirmar';

const Header = ({ isAdmin, username, onLogout, onLogin }) => {
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = () => {
    onLogout();
    setShowLogoutModal(false);
  };

  const cancelLogout = () => {
    setShowLogoutModal(false);
  };

  return (
    <div className="header bg-gray-800 shadow-lg p-5 py-8 flex justify-between items-center">
      <h1 className="text-center text-white font-bold text-4xl">
        {isAdmin ? 'Digesto - Administración' : 'Digesto - Consulta'}
      </h1>
      <div>
        {!username && (
          <button onClick={onLogin} className="text-white font-bold py-2 px-2 hover:shadow-xl" title="Iniciar sesión">
            <LogIn className="mr-2" />
          </button>
        )}
        {username && (
          <div className='flex items-center'>
            <span className="text-white mr-1 text-lg align-middle" style={{ display: 'inline-flex', alignItems: 'center' }}>{username}</span> {/* Aquí se muestra el nombre de usuario */}
            <button onClick={handleLogoutClick} className="text-white font-bold py-2 px-4  rounded " title="Cerrar sesión">
              <LogOut className="mr-2" />
            </button>
          </div>
        )}
      </div>

      {/* Modal de confirmación de cierre de sesión */}
      {showLogoutModal && (
        <ModalConfirmar
          title="Cerrar sesión"
          message="¿Seguro que desea cerrar sesión?"
          onCancel={cancelLogout}
          onConfirm={confirmLogout}
        />
      )}
    </div>
  );
};

export default Header;
