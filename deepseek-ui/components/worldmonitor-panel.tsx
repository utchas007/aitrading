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
          Real-time stock indices, commodities, forex & crypto
        </p>
      </div>
      
      <div className="relative bg-black">
        <iframe
          src="http://192.168.2.232:3000/?variant=finance"
          className="w-full h-[700px] border-0"
          title="World Monitor Finance"
        />
        
        {/* Overlay with data indicators */}
        <div className="absolute top-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg p-3 text-xs pointer-events-none">
          <div className="text-green-400 font-mono mb-1">● LIVE DATA</div>
          <div className="text-gray-300 space-y-1">
            <div>📊 Stock Indices</div>
            <div>🛢️ Commodities</div>
            <div>💱 Forex</div>
            <div>₿ Crypto</div>
          </div>
        </div>
      </div>
    </Card>
  );
}
