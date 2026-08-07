import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface FilterDropdownProps {
  label: string;
  selectedValue: string;
  options: string[];
  onSelect: (value: string) => void;
  defaultOption: string;
}

export default function FilterDropdown({ label, selectedValue, options, onSelect, defaultOption }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (value: string) => {
    onSelect(value);
    setIsOpen(false);
  };

  return (
    <View style={{ zIndex: isOpen ? 100 : 1 }}>
      <Pressable 
        style={[styles.filterBtn, isOpen && styles.filterBtnActive]} 
        onPress={() => setIsOpen(!isOpen)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
      >
        <Text style={styles.filterBtnText}>{selectedValue}</Text>
        <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={14} color={isOpen ? "#F9FAFB" : "#9CA3AF"} />
      </Pressable>

      {isOpen && (
        <>
          {/* Invisible overlay to catch outside clicks (covers the whole screen using fixed/absolute tricks but rooted here) */}
          <Pressable 
            style={styles.backdrop} 
            onPress={() => setIsOpen(false)} 
          />
          
          <View style={styles.dropdownOverlay}>
            <ScrollView 
              style={styles.dropdownScroll} 
              showsVerticalScrollIndicator={true}
              bounces={false}
            >
              <Pressable 
                style={[styles.dropdownItem, selectedValue === defaultOption && styles.dropdownItemSelected]} 
                onPress={() => handleSelect(defaultOption)}
              >
                <Text style={[styles.dropdownItemText, selectedValue === defaultOption && styles.dropdownItemTextSelected]}>
                  {defaultOption}
                </Text>
                {selectedValue === defaultOption && <Feather name="check" size={14} color="#8B5CF6" />}
              </Pressable>
              
              {options && options.map(opt => (
                <Pressable 
                  key={opt} 
                  style={[styles.dropdownItem, selectedValue === opt && styles.dropdownItemSelected]} 
                  onPress={() => handleSelect(opt)}
                >
                  <Text style={[styles.dropdownItemText, selectedValue === opt && styles.dropdownItemTextSelected]}>
                    {opt}
                  </Text>
                  {selectedValue === opt && <Feather name="check" size={14} color="#8B5CF6" />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F131A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E2535',
    gap: 8,
  },
  filterBtnActive: {
    borderColor: '#374151',
    backgroundColor: '#1E2535',
  },
  filterBtnText: {
    fontSize: 13,
    color: '#D1D5DB',
  },
  backdrop: {
    position: 'absolute',
    top: -1000,
    bottom: -1000,
    left: -1000,
    right: -1000,
    backgroundColor: 'transparent',
    zIndex: 999,
  },
  dropdownOverlay: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    minWidth: 160,
    backgroundColor: '#1E2535',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
    maxHeight: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    overflow: 'hidden', 
    zIndex: 1000,
  },
  dropdownScroll: {
    flexGrow: 0, // allow shrinking
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownItemSelected: {
    backgroundColor: '#2A3347',
  },
  dropdownItemText: {
    color: '#D1D5DB',
    fontSize: 13,
  },
  dropdownItemTextSelected: {
    color: '#F9FAFB',
    fontWeight: '600',
  }
});
