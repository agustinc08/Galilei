// Tabs.js
import React, { useState } from 'react';
import TabCarga from './TabCarga';
import TabBusqueda from './TabBusqueda';

const Tabs = ({ isAdmin }) => {
  const [activeTab, setActiveTab] = useState('busqueda');
  const [selectedItem, setSelectedItem] = useState(null);


  const handleTabChange = (tab) => {
    // Solo actualiza el estado si el tab es diferente
    if (tab !== activeTab) {
        setActiveTab(tab);

        // Limpiar el item seleccionado al cambiar de pestaña
        setSelectedItem(null);
      }
  };


  return (
    <div className="bg-gray-300 p-4 ">
      <div className="flex space-x-4">
        <button
          className={`${
            activeTab === 'busqueda' ? 'bg-blue-500 text-white' : 'bg-gray-300 text-neutral-700'
          } borde-inferior-centrado uppercase text-sm px-4 py-2 rounded-t-md font-bold`}
          onClick={() => handleTabChange('busqueda')}
        >
          Búsquedas
        </button>
        {isAdmin && (
          <button
            className={`${
              activeTab === 'carga' ? 'bg-blue-500 text-white' : 'bg-gray-300 text-neutral-700'
            } borde-inferior-centrado uppercase text-sm px-4 py-2 rounded-t-md font-bold`}
            onClick={() => handleTabChange('carga')}
          >
            Carga
          </button>
        )}
      </div>

      {activeTab === 'busqueda' && <TabBusqueda isAdmin={isAdmin} setSelectedItem={setSelectedItem} />}
      {activeTab === 'carga' && <TabCarga isAdmin={isAdmin} onTabChange={handleTabChange}/>}
    </div>
  );
};

export default Tabs;
