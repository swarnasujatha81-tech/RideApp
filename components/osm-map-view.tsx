import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Region = Coordinate & {
  latitudeDelta?: number;
  longitudeDelta?: number;
};

type OSMMarker = {
  coordinate: Coordinate;
  title?: string;
  description?: string;
  color?: string;
  label?: string;
};

type OSMMapPressEvent = {
  nativeEvent: {
    coordinate: Coordinate;
  };
};

type OSMMapViewProps = {
  style?: StyleProp<ViewStyle>;
  initialRegion: Region;
  markers?: OSMMarker[];
  onPress?: (event: OSMMapPressEvent) => void;
};

export type OSMMapViewRef = {
  animateToRegion: (region: Region, durationMs?: number) => void;
};

function getZoom(region: Region) {
  const delta = Math.max(region.latitudeDelta || 0.05, region.longitudeDelta || 0.05);
  if (delta <= 0.01) return 15;
  if (delta <= 0.025) return 14;
  if (delta <= 0.05) return 13;
  if (delta <= 0.1) return 12;
  return 11;
}

function getHtml(region: Region, markers: OSMMarker[]) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }
    .pin {
      width: 18px;
      height: 18px;
      border-radius: 50% 50% 50% 0;
      border: 2px solid #fff;
      transform: rotate(-45deg);
      box-shadow: 0 1px 4px rgba(0,0,0,0.35);
    }
    .pin span {
      display: block;
      transform: rotate(45deg);
      color: #fff;
      font: 700 10px Arial, sans-serif;
      line-height: 18px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var initialRegion = ${JSON.stringify(region)};
    var currentMarkers = [];
    var map = L.map('map', { zoomControl: false, attributionControl: true }).setView(
      [initialRegion.latitude, initialRegion.longitude],
      ${getZoom(region)}
    );

    L.tileLayer('https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(map);

    function markerIcon(marker) {
      var label = marker.label ? String(marker.label).slice(0, 2) : '';
      return L.divIcon({
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 22],
        popupAnchor: [0, -22],
        html: '<div class="pin" style="background:' + (marker.color || '#EF4444') + '"><span>' + label + '</span></div>'
      });
    }

    function setMarkers(markers) {
      currentMarkers.forEach(function(marker) { map.removeLayer(marker); });
      currentMarkers = [];
      markers.forEach(function(marker) {
        if (!marker || !marker.coordinate) return;
        var item = L.marker([marker.coordinate.latitude, marker.coordinate.longitude], { icon: markerIcon(marker) }).addTo(map);
        if (marker.title || marker.description) {
          item.bindPopup([marker.title, marker.description].filter(Boolean).join('<br/>'));
        }
        currentMarkers.push(item);
      });
    }

    setMarkers(${JSON.stringify(markers)});

    map.on('click', function(event) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'press',
        coordinate: {
          latitude: event.latlng.lat,
          longitude: event.latlng.lng
        }
      }));
    });

    document.addEventListener('message', function(event) {
      handleMessage(event.data);
    });
    window.addEventListener('message', function(event) {
      handleMessage(event.data);
    });

    function handleMessage(raw) {
      try {
        var payload = JSON.parse(raw);
        if (payload.type === 'setMarkers') {
          setMarkers(payload.markers || []);
        }
        if (payload.type === 'animateToRegion' && payload.region) {
          map.setView([payload.region.latitude, payload.region.longitude], payload.zoom || 13, { animate: true });
        }
      } catch (error) {}
    }
  </script>
</body>
</html>`;
}

const OSMMapView = forwardRef<OSMMapViewRef, OSMMapViewProps>(({ style, initialRegion, markers = [], onPress }, ref) => {
  const webViewRef = useRef<WebView | null>(null);
  const html = useMemo(() => getHtml(initialRegion, markers), []);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region: Region, _durationMs?: number) => {
      webViewRef.current?.postMessage(JSON.stringify({ type: 'animateToRegion', region, zoom: getZoom(region) }));
    },
  }));

  const serializedMarkers = JSON.stringify(markers);
  React.useEffect(() => {
    webViewRef.current?.postMessage(JSON.stringify({ type: 'setMarkers', markers }));
  }, [serializedMarkers]);

  return (
    <WebView
      ref={webViewRef}
      style={style}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      source={{ html, baseUrl: 'https://localhost' }}
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'press' && data.coordinate) {
            onPress?.({ nativeEvent: { coordinate: data.coordinate } });
          }
        } catch (error) {
          console.warn('[OSMMapView] ignored invalid message', error);
        }
      }}
      onError={(event) => {
        console.error('[OSMMapView] WebView error', event.nativeEvent);
      }}
      onLoadEnd={() => {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'setMarkers', markers }));
      }}
    />
  );
});

OSMMapView.displayName = 'OSMMapView';

export default OSMMapView;
