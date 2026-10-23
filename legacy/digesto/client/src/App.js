import React, { useEffect, useState } from 'react';
import './css/styles.css';
import Header from './components/Header';
import Tabs from './components/Tabs';
import Login from './components/Login';
import Footer from './components/Footer';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(true);
  const [hasShownLoginNotification, setHasShownLoginNotification] = useState(false);

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('currentUser');
    setHasShownLoginNotification(false);
    setIsLoginModalOpen(true);
  };

  const handleLogin = (userData) => {
    setCurrentUser(userData);
    setIsLoginModalOpen(false);
    localStorage.setItem('currentUser', JSON.stringify(userData));
    toast.success('¡Inicio de sesión exitoso!');
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      setCurrentUser(JSON.parse(storedUser));
    }
  }, []);

  // return (
  //   <div className="grid grid-rows-[auto,1fr,auto] min-h-screen">
  //     <Header
  //       username={currentUser ? currentUser.username.username : null} // Pasar solo el nombre de usuario
  //       onLogin={handleLogin}
  //       isAdmin={currentUser && currentUser.role === 'admin'}
  //       onLogout={handleLogout}
  //     />
  //     <div className="overflow-y-auto">
  //       {!currentUser ? ( // CONSULTA:
  //         <>
  //           <Tabs />
  //           {isLoginModalOpen && (
  //             <Login
  //               onLogin={handleAdminLogin}
  //               isOpen={isLoginModalOpen}
  //               onClose={() => setIsLoginModalOpen(false)}
  //             />
  //           )}
  //         </>
  //       ) : ( // ADMINISTRACIÓN:
  //         <Tabs isAdmin={currentUser && currentUser.role === 'admin'} /> // No pasamos el nombre de usuario aquí
  //       )}
  //     </div>
  //     <ToastContainer position="bottom-right" autoClose={2000} />
  //     <Footer />
  //   </div>
  // );

  return (
    <div className="grid grid-rows-[auto,1fr,auto] min-h-screen">
      {!currentUser || currentUser === 0 || currentUser === null ? (

        <Login
          onLogin={handleLogin}
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
        />

      ) : (
        <>
          <Header
            username={currentUser.username} // Pasar solo el nombre de usuario
            onLogin={handleLogin}
            isAdmin={currentUser.role === 'admin'}
            onLogout={handleLogout}
          />
          <Tabs isAdmin={currentUser.role === 'admin'} />
          <Footer />
          <ToastContainer position='bottom-right' autoClose={2000} />
        </>
      )}
    </div>
  );
}

export default App;
