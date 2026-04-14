'use client';

import { Card } from '@/components/ui/card';

export function WorldMonitorPanel() {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span>🌍</span>
          World Monitor - Global Markets
        </h2>
        <p className="text-sm text-blue-100 mt-1">
          Global infrastructure, weather, economic data & real-time events
        </p>
      </div>
      
      <div className="relative bg-black">
        <iframe
          src="http://localhost:3000/?lat=1.1526&lon=0.0000&zoom=1.00&view=global&timeRange=7d&layers=cables%2Cpipelines%2Cweather%2Ceconomic%2Cwaterways%2Coutages%2Cdatacenters%2Cnatural%2Cfires%2CstartupHubs%2CcloudRegions%2Caccelerators%2CtechHQs%2CtechEvents%2CtradeRoutes%2CiranAttacks"
          className="w-full h-[700px] border-0"
          title="World Monitor Finance"
        />
        
        {/* Overlay with data indicators */}
        <div className="absolute top-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg p-3 text-xs pointer-events-none">
          <div className="text-green-400 font-mono mb-1">● LIVE DATA</div>
          <div className="text-gray-300 space-y-1">
            <div>🌐 Infrastructure</div>
            <div>🌤️ Weather</div>
            <div>📡 Data Centers</div>
            <div>🔥 Events & Fires</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
